/**
 * Health Connect MCP — Google Apps Script Sync
 *
 * Reads the Android Health Connect SQLite export directly (no WASM needed),
 * applies aggregation on large time-series tables, and sends the data in
 * JSON batches to the Cloudflare Worker /ingest-batch endpoint.
 *
 * Setup — Script Properties (Project Settings → Script Properties):
 *   INGEST_URL  https://health-connect-mcp.<subdomain>.workers.dev/ingest-batch
 *   API_KEY     your secret API key
 *
 * Run syncHealthConnect() once manually to test, then call setupWeeklyTrigger()
 * to schedule automatic weekly syncs every Sunday at 3 am.
 */

/* ============================================================
   CONFIGURATION
   ============================================================ */

var BATCH_SIZE = 200;      // rows per HTTP POST to Worker
var SAFETY_VALVE = 500000; // auto-aggregate tables exceeding this row count

// Series tables aggregated to summaries instead of stored raw
var SERIES_AGGREGATORS = {
  'heart_rate_record_series_table':        'heartRate',
  'exercise_route_table':                  'exerciseRoute',
  'cycling_pedaling_cadence_record_table': 'timeSeries',
  'power_record_table':                    'timeSeries',
  'speed_record_table':                    'timeSeries',
  'steps_cadence_record_table':            'timeSeries',
  'skin_temperature_delta_table':          'timeSeries'
};

/* ============================================================
   SQLITE BINARY FORMAT READER
   Pure JavaScript — no WebAssembly, works in Apps Script V8
   ============================================================ */

/**
 * Opens a SQLite .db blob for reading.
 * @param {Blob} blob  Google Apps Script Blob (from DriveApp or Utilities.unzip)
 */
function SQLiteReader(blob) {
  this.blob = blob;
  this._cache = {}; // pageNum → unsigned byte array

  // Read 100-byte database header
  var hdr = this._bytes(0, 100);

  // Validate magic string "SQLite format 3\0"
  if (hdr[0] !== 83 || hdr[1] !== 81 || hdr[2] !== 76) {
    throw new Error('Not a SQLite database');
  }

  // Page size: 2 bytes big-endian at offset 16 (value 1 means 65536)
  var ps = (hdr[16] << 8) | hdr[17];
  this.pageSize = ps === 1 ? 65536 : ps;

  // Usable page size = pageSize minus reserved bytes (offset 20)
  this.usable = this.pageSize - hdr[20];
}

/** Read a byte range from the blob as an array of unsigned ints [0..255]. */
SQLiteReader.prototype._bytes = function (start, end) {
  var raw = this.blob.copySlice(start, end).getBytes();
  var r = new Array(end - start);
  for (var i = 0; i < r.length; i++) r[i] = raw[i] & 0xFF;
  return r;
};

/**
 * Return the bytes for a 1-indexed page, cached.
 * Cache evicts oldest entry when it reaches 100 pages.
 */
SQLiteReader.prototype._page = function (n) {
  if (this._cache[n]) return this._cache[n];
  var keys = Object.keys(this._cache);
  if (keys.length >= 100) delete this._cache[keys[0]];
  var start = (n - 1) * this.pageSize;
  this._cache[n] = this._bytes(start, start + this.pageSize);
  return this._cache[n];
};

/* ---- Low-level integer helpers ---- */

function _u16(b, o) { return (b[o] << 8) | b[o + 1]; }

function _u32(b, o) {
  return (b[o] * 0x1000000) + ((b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]);
}

/** Read a SQLite variable-length integer. Returns [value, bytesConsumed]. */
function _varint(b, o) {
  var v = 0;
  for (var i = 0; i < 9; i++) {
    var byte_ = b[o + i];
    if (i < 8) {
      v = v * 128 + (byte_ & 0x7F);
      if (!(byte_ & 0x80)) return [v, i + 1];
    } else {
      return [v * 256 + byte_, 9];
    }
  }
  return [v, 9];
}

/** Decode a UTF-8 byte slice to a JavaScript string. */
function _utf8(b, o, n) {
  var s = '', i = o, e = o + n;
  while (i < e) {
    var c = b[i];
    if (c < 0x80) {
      s += String.fromCharCode(c); i++;
    } else if (c < 0xE0) {
      s += String.fromCharCode(((c & 0x1F) << 6) | (b[i + 1] & 0x3F)); i += 2;
    } else if (c < 0xF0) {
      s += String.fromCharCode(((c & 0x0F) << 12) | ((b[i + 1] & 0x3F) << 6) | (b[i + 2] & 0x3F)); i += 3;
    } else {
      var cp = ((c & 0x07) << 18) | ((b[i + 1] & 0x3F) << 12) | ((b[i + 2] & 0x3F) << 6) | (b[i + 3] & 0x3F);
      cp -= 0x10000;
      s += String.fromCharCode(0xD800 + (cp >> 10)) + String.fromCharCode(0xDC00 + (cp & 0x3FF));
      i += 4;
    }
  }
  return s;
}

/** Convert bytes to lowercase hex string. */
function _hex(b, o, n) {
  var s = '';
  for (var i = 0; i < n; i++) s += ('0' + b[o + i].toString(16)).slice(-2);
  return s;
}

/** Convert a 16-byte BLOB to UUID string format xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx. */
function _uuid(b, o) {
  var h = _hex(b, o, 16);
  return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
}

/* ---- Payload reading (with overflow page support) ---- */

/**
 * Read a cell's full payload, following overflow pages if needed.
 * Returns an array of unsigned bytes.
 */
SQLiteReader.prototype._payload = function (page, off, size) {
  var X = this.usable - 35; // max inline payload for a table leaf cell

  if (size <= X) return page.slice(off, off + size);

  // Overflow: compute how many bytes stay in the leaf
  var U = this.usable;
  var M = Math.floor(((U - 12) * 32 / 255) - 23);
  var K = M + ((size - M) % (U - 4));
  if (K > X) K = M;

  var parts = [page.slice(off, off + K)];
  var total = K;
  var next = _u32(page, off + K);

  while (next && total < size) {
    var ov = this._page(next);
    next = _u32(ov, 0);
    var take = Math.min(size - total, U - 4);
    parts.push(ov.slice(4, 4 + take));
    total += take;
  }

  if (parts.length === 1) return parts[0];
  var result = [];
  for (var i = 0; i < parts.length; i++) {
    var p = parts[i];
    for (var j = 0; j < p.length; j++) result.push(p[j]);
  }
  return result;
};

/* ---- Record parsing ---- */

/**
 * Parse a SQLite record payload into a plain row object.
 * @param {Array}  payload   Unsigned byte array
 * @param {Array}  colNames  Column name array from CREATE TABLE
 */
function _parseRecord(payload, colNames) {
  var vr = _varint(payload, 0);
  var headerSize = vr[0], hOff = vr[1], dOff = headerSize;
  var types = [], row = {}, i, j, st, val;

  while (hOff < headerSize) {
    vr = _varint(payload, hOff);
    types.push(vr[0]);
    hOff += vr[1];
  }

  for (i = 0; i < types.length; i++) {
    st = types[i]; val = null;

    if      (st === 0) { val = null; }
    else if (st === 1) { val = payload[dOff] >= 128 ? payload[dOff] - 256 : payload[dOff]; dOff += 1; }
    else if (st === 2) { val = _u16(payload, dOff); if (val >= 32768) val -= 65536; dOff += 2; }
    else if (st === 3) { val = (payload[dOff] << 16) | (payload[dOff + 1] << 8) | payload[dOff + 2]; if (val >= 8388608) val -= 16777216; dOff += 3; }
    else if (st === 4) { val = _u32(payload, dOff); if (val >= 2147483648) val -= 4294967296; dOff += 4; }
    else if (st === 5) { val = _u16(payload, dOff) * 4294967296 + _u32(payload, dOff + 2); dOff += 6; }
    else if (st === 6) { val = _u32(payload, dOff) * 4294967296 + _u32(payload, dOff + 4); dOff += 8; }
    else if (st === 7) {
      var dv = new DataView(new ArrayBuffer(8));
      for (j = 0; j < 8; j++) dv.setUint8(j, payload[dOff + j]);
      val = dv.getFloat64(0, false); // big-endian
      dOff += 8;
    }
    else if (st === 8) { val = 0; }
    else if (st === 9) { val = 1; }
    else if (st >= 12 && st % 2 === 0) {
      var blen = (st - 12) / 2;
      val = (blen === 16) ? _uuid(payload, dOff) : _hex(payload, dOff, blen);
      dOff += blen;
    }
    else if (st >= 13 && st % 2 === 1) {
      var tlen = (st - 13) / 2;
      val = _utf8(payload, dOff, tlen);
      dOff += tlen;
    }

    if (i < colNames.length) row[colNames[i]] = val;
  }
  return row;
}

/* ---- B-tree traversal (streaming via callback) ---- */

/**
 * Scan a table B-tree rooted at rootPage, calling onRow(row) for every record.
 * Streaming: does not accumulate rows, suitable for very large tables.
 */
SQLiteReader.prototype.scan = function (rootPage, colNames, onRow) {
  this._scan(rootPage, colNames, onRow);
};

SQLiteReader.prototype._scan = function (pageNum, colNames, onRow) {
  var page = this._page(pageNum);
  var hOff = pageNum === 1 ? 100 : 0; // page 1 has a 100-byte file header prefix
  var pageType = page[hOff];
  var nCells = _u16(page, hOff + 3);
  var ptrOff = hOff + (pageType === 5 ? 12 : 8); // cell pointer array start
  var i, cPtr, v, off;

  if (pageType === 13) {
    // Table B-tree leaf: extract records
    for (i = 0; i < nCells; i++) {
      cPtr = _u16(page, ptrOff + i * 2);
      v = _varint(page, cPtr);
      var paySize = v[0];
      off = cPtr + v[1];
      v = _varint(page, off); off += v[1]; // skip rowId
      var payload = this._payload(page, off, paySize);
      onRow(_parseRecord(payload, colNames));
    }
  } else if (pageType === 5) {
    // Table B-tree interior: recurse into children
    for (i = 0; i < nCells; i++) {
      cPtr = _u16(page, ptrOff + i * 2);
      this._scan(_u32(page, cPtr), colNames, onRow);
    }
    this._scan(_u32(page, hOff + 8), colNames, onRow); // rightmost child
  }
};

/* ---- CREATE TABLE schema parsing ---- */

/**
 * Extract column names from a CREATE TABLE SQL string.
 * Handles quoted identifiers; skips table-level constraints.
 */
function parseColumns(sql) {
  if (!sql) return [];
  var s = sql.indexOf('(') + 1;
  if (s <= 0) return [];

  // Find matching closing paren
  var d = 1, e = s;
  while (e < sql.length && d > 0) {
    if (sql[e] === '(') d++;
    else if (sql[e] === ')') d--;
    e++;
  }
  var body = sql.slice(s, e - 1);

  // Split by top-level commas
  var parts = [], curr = '', depth = 0, c, i;
  for (i = 0; i < body.length; i++) {
    c = body[i];
    if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (c === ',' && depth === 0) { parts.push(curr.trim()); curr = ''; continue; }
    curr += c;
  }
  if (curr.trim()) parts.push(curr.trim());

  var cols = [], m;
  for (i = 0; i < parts.length; i++) {
    var p = parts[i].trim();
    if (/^(PRIMARY\s+KEY|UNIQUE|CHECK|FOREIGN\s+KEY)/i.test(p)) continue;
    m = p.match(/^["`]?([a-zA-Z_][a-zA-Z0-9_]*)["`]?/);
    if (m) cols.push(m[1]);
  }
  return cols;
}

/* ============================================================
   AGGREGATORS
   Each aggregator: { onRow(row), finalize() → rows[] }
   ============================================================ */

function _toDay(epochMs) {
  return new Date(epochMs).toISOString().slice(0, 10);
}

function makeAggregator(type) {

  if (type === 'heartRate') return {
    _s: {},
    onRow: function (r) {
      var d = _toDay(r.epoch_millis);
      if (!this._s[d]) this._s[d] = { min: Infinity, max: -Infinity, sum: 0, n: 0 };
      var bpm = +r.beats_per_minute;
      var s = this._s[d];
      if (bpm < s.min) s.min = bpm;
      if (bpm > s.max) s.max = bpm;
      s.sum += bpm; s.n++;
    },
    finalize: function () {
      var keys = Object.keys(this._s), result = [];
      for (var i = 0; i < keys.length; i++) {
        var s = this._s[keys[i]];
        result.push({ date: keys[i], min_bpm: s.min, max_bpm: s.max, avg_bpm: Math.round(s.sum / s.n * 10) / 10, sample_count: s.n });
      }
      return result;
    }
  };

  if (type === 'exerciseRoute') return {
    _s: {},
    onRow: function (r) {
      var k = r.parent_key;
      if (!this._s[k]) this._s[k] = { parent_key: k, start_ms: r.timestamp_millis, end_ms: r.timestamp_millis, point_count: 0, min_lat: r.latitude, max_lat: r.latitude, min_lon: r.longitude, max_lon: r.longitude };
      var s = this._s[k];
      if (r.timestamp_millis < s.start_ms) s.start_ms = r.timestamp_millis;
      if (r.timestamp_millis > s.end_ms) s.end_ms = r.timestamp_millis;
      if (r.latitude < s.min_lat) s.min_lat = r.latitude;
      if (r.latitude > s.max_lat) s.max_lat = r.latitude;
      if (r.longitude < s.min_lon) s.min_lon = r.longitude;
      if (r.longitude > s.max_lon) s.max_lon = r.longitude;
      s.point_count++;
    },
    finalize: function () {
      var keys = Object.keys(this._s), result = [];
      for (var i = 0; i < keys.length; i++) result.push(this._s[keys[i]]);
      return result;
    }
  };

  // Generic time-series: count occurrences per day
  return {
    _s: {},
    onRow: function (r) {
      var ms = r.epoch_millis !== undefined ? r.epoch_millis : r.timestamp_millis;
      if (ms == null) return;
      var d = _toDay(ms);
      if (!this._s[d]) this._s[d] = { date: d, count: 0 };
      this._s[d].count++;
    },
    finalize: function () {
      var keys = Object.keys(this._s), result = [];
      for (var i = 0; i < keys.length; i++) result.push(this._s[keys[i]]);
      return result;
    }
  };
}

/* ============================================================
   WORKER COMMUNICATION
   ============================================================ */

function _post(url, key, table, rows, syncId, done) {
  var resp = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'Authorization': 'Bearer ' + key },
    payload: JSON.stringify({ table: table, rows: rows, syncId: syncId, done: !!done }),
    muteHttpExceptions: true
  });
  var code = resp.getResponseCode();
  if (code !== 200) {
    throw new Error('Worker returned HTTP ' + code + ': ' + resp.getContentText().slice(0, 300));
  }
}

function sendTable(url, key, tableName, rows, syncId, isLastTable) {
  for (var i = 0; i < rows.length; i += BATCH_SIZE) {
    var chunk = rows.slice(i, i + BATCH_SIZE);
    var done = isLastTable && (i + BATCH_SIZE >= rows.length);
    _post(url, key, tableName, chunk, syncId, done);
  }
  if (rows.length === 0 && isLastTable) {
    _post(url, key, tableName, [], syncId, true);
  }
}

/* ============================================================
   MAIN SYNC FUNCTION
   ============================================================ */

function syncHealthConnect() {
  var props = PropertiesService.getScriptProperties();
  var url = props.getProperty('INGEST_URL');
  var key = props.getProperty('API_KEY');

  if (!url || !key) {
    Logger.log('ERROR: Set INGEST_URL and API_KEY in Script Properties');
    return;
  }

  var blob = findExportBlob();
  if (!blob) {
    Logger.log('ERROR: Could not find health_connect_export.db (or .zip) in Drive');
    return;
  }

  var syncId = new Date().toISOString();
  Logger.log('Sync started: ' + syncId);

  try {
    var db = new SQLiteReader(blob);
    Logger.log('SQLite opened — page size: ' + db.pageSize + ' bytes');

    // Read sqlite_master (page 1) to discover all tables
    var masterCols = ['type', 'name', 'tbl_name', 'rootpage', 'sql'];
    var masterRows = [];
    db.scan(1, masterCols, function (r) { masterRows.push(r); });

    // Keep only real user tables
    var tables = [];
    for (var i = 0; i < masterRows.length; i++) {
      var m = masterRows[i];
      if (m.type === 'table' && m.name && String(m.name).indexOf('sqlite_') !== 0) {
        tables.push(m);
      }
    }
    Logger.log('Tables discovered: ' + tables.length);

    for (var t = 0; t < tables.length; t++) {
      var meta = tables[t];
      var name = String(meta.name);
      var rootpage = meta.rootpage;
      var cols = parseColumns(meta.sql);
      var isLast = (t === tables.length - 1);

      if (!cols.length || !rootpage) {
        Logger.log('Skipping ' + name + ' — could not parse schema');
        continue;
      }

      Logger.log('Processing: ' + name + ' (' + cols.length + ' columns)');

      try {
        var aggType = SERIES_AGGREGATORS[name];

        if (aggType) {
          // Streaming aggregation — memory-efficient for multi-million-row tables
          var agg = makeAggregator(aggType);
          db.scan(rootpage, cols, function (r) { agg.onRow(r); });
          var rows = agg.finalize();
          Logger.log('  → ' + rows.length + ' aggregated rows (from streaming)');
          sendTable(url, key, name, rows, syncId, isLast);

        } else {
          // Collect rows; safety valve prevents OOM on unexpectedly large tables
          var rows = [];
          var truncated = false;
          db.scan(rootpage, cols, function (r) {
            if (rows.length < SAFETY_VALVE) rows.push(r);
            else truncated = true;
          });
          if (truncated) Logger.log('  WARNING: ' + name + ' truncated to ' + SAFETY_VALVE + ' rows');
          Logger.log('  → ' + rows.length + ' rows');
          sendTable(url, key, name, rows, syncId, isLast);
        }

      } catch (e) {
        Logger.log('Error processing ' + name + ': ' + e);
      }
    }

    Logger.log('Sync complete — ' + tables.length + ' tables processed');

  } catch (e) {
    Logger.log('Sync failed: ' + e);
    throw e;
  }
}

/* ============================================================
   DRIVE HELPERS
   ============================================================ */

function findExportBlob() {
  var props = PropertiesService.getScriptProperties();
  var folderId = props.getProperty('FOLDER_ID');

  // If a specific folder ID is set, search only within that folder
  if (folderId) {
    try {
      var folder = DriveApp.getFolderById(folderId);
      Logger.log('Searching in folder: ' + folder.getName());

      // Try .db file first
      var iter = folder.getFilesByName('health_connect_export.db');
      if (iter.hasNext()) return iter.next().getBlob();

      // Try common zip names
      var zipNames = ['health_connect_export.zip', 'health-connect-export.zip'];
      for (var i = 0; i < zipNames.length; i++) {
        iter = folder.getFilesByName(zipNames[i]);
        if (iter.hasNext()) return extractDbFromZip(iter.next().getBlob());
      }

      // Search by partial name within the folder
      iter = folder.searchFiles('title contains "health_connect"');
      while (iter.hasNext()) {
        var file = iter.next();
        var name = file.getName();
        if (name.slice(-3) === '.db') return file.getBlob();
        if (name.slice(-4) === '.zip') return extractDbFromZip(file.getBlob());
      }

      Logger.log('File not found in specified folder — falling back to full Drive search');
    } catch (e) {
      Logger.log('WARNING: Could not open folder ' + folderId + ': ' + e + ' — falling back to full Drive search');
    }
  }

  // Fall back to searching all of Drive
  var iter = DriveApp.getFilesByName('health_connect_export.db');
  if (iter.hasNext()) return iter.next().getBlob();

  var zipNames = ['health_connect_export.zip', 'health-connect-export.zip'];
  for (var i = 0; i < zipNames.length; i++) {
    iter = DriveApp.getFilesByName(zipNames[i]);
    if (iter.hasNext()) return extractDbFromZip(iter.next().getBlob());
  }

  iter = DriveApp.searchFiles('title contains "health_connect" and title contains ".db"');
  if (iter.hasNext()) return iter.next().getBlob();

  return null;
}

function extractDbFromZip(zipBlob) {
  var files = Utilities.unzip(zipBlob);
  for (var i = 0; i < files.length; i++) {
    var n = files[i].getName();
    if (n.slice(-3) === '.db' || n.indexOf('health_connect') !== -1) return files[i];
  }
  return null;
}

/* ============================================================
   TRIGGER SETUP
   ============================================================ */

function setupWeeklyTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'syncHealthConnect') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  ScriptApp.newTrigger('syncHealthConnect')
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.SUNDAY)
    .atHour(3)
    .create();
  Logger.log('Weekly trigger set: Sundays at 3 am');
}
