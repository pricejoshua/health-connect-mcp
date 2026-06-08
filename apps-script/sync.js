/**
 * Health Connect MCP — Weekly Sync Script
 *
 * Setup:
 * 1. Go to script.google.com → New project
 * 2. Paste this entire file
 * 3. Project Settings → Script Properties → Add script property:
 *    - INGEST_URL = https://<your-worker>.workers.dev/ingest
 *    - API_KEY    = <your-secret-key>
 * 4. Run syncHealthConnect() once manually to verify
 * 5. Run setupWeeklyTrigger() once to enable the weekly cron
 */

var EXPORT_FILENAME = 'health_connect_export.db';
var ZIP_FILENAME    = 'health_connect_export.zip';

function getScriptProp(key) {
  return PropertiesService.getScriptProperties().getProperty(key);
}

/**
 * Find the Health Connect export in Google Drive.
 * Checks for raw .db first, then a zip containing it.
 * Returns { type: 'db'|'zip', file: DriveFile }
 */
function findExportFile() {
  var dbFiles = DriveApp.getFilesByName(EXPORT_FILENAME);
  if (dbFiles.hasNext()) {
    return { type: 'db', file: dbFiles.next() };
  }
  var zipFiles = DriveApp.getFilesByName(ZIP_FILENAME);
  if (zipFiles.hasNext()) {
    return { type: 'zip', file: zipFiles.next() };
  }
  throw new Error(
    'Export file not found in Drive. Expected: ' + EXPORT_FILENAME + ' or ' + ZIP_FILENAME
  );
}

/**
 * Extract the .db blob from a zip blob.
 */
function extractDbFromZip(zipBlob) {
  var entries = Utilities.unzip(zipBlob);
  for (var i = 0; i < entries.length; i++) {
    if (entries[i].getName().match(/\.db$/)) {
      return entries[i];
    }
  }
  throw new Error('No .db file found inside zip.');
}

/**
 * POST raw .db bytes to the ingest endpoint.
 * Returns the parsed JSON response body.
 */
function postToIngest(dbBlob) {
  var ingestUrl = getScriptProp('INGEST_URL');
  var apiKey    = getScriptProp('API_KEY');

  if (!ingestUrl || !apiKey) {
    throw new Error('INGEST_URL and API_KEY must be set in Script Properties.');
  }

  var response = UrlFetchApp.fetch(ingestUrl, {
    method: 'post',
    contentType: 'application/octet-stream',
    headers: { 'Authorization': 'Bearer ' + apiKey },
    payload: dbBlob.getBytes(),
    muteHttpExceptions: true,
  });

  var code = response.getResponseCode();
  var body = response.getContentText();

  if (code !== 200) {
    throw new Error('Ingest returned ' + code + ': ' + body);
  }

  return JSON.parse(body);
}

/**
 * Main entry point. Called by the weekly trigger (or manually).
 */
function syncHealthConnect() {
  var start = new Date();
  Logger.log('Sync started: ' + start.toISOString());

  try {
    var found = findExportFile();
    Logger.log('Found: ' + found.file.getName() + ' (' + found.type + ')');

    var dbBlob = found.type === 'zip'
      ? extractDbFromZip(found.file.getBlob())
      : found.file.getBlob();

    Logger.log('Posting to ingest endpoint...');
    var result = postToIngest(dbBlob);

    var elapsed   = ((new Date() - start) / 1000).toFixed(1);
    var tables    = result.tables || {};
    var tableCount = Object.keys(tables).length;
    var totalRows  = Object.keys(tables).reduce(function(sum, k) {
      return sum + (tables[k].rows || 0);
    }, 0);

    Logger.log(
      'Done in ' + elapsed + 's — ' + tableCount + ' tables, ' + totalRows + ' rows'
    );
    Logger.log(JSON.stringify(result, null, 2));
  } catch (e) {
    Logger.log('SYNC FAILED: ' + e.message);
    throw e;
  }
}

/**
 * Run once to create the weekly Sunday 3am trigger.
 * Removes any existing syncHealthConnect triggers first.
 */
function setupWeeklyTrigger() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'syncHealthConnect') {
      ScriptApp.deleteTrigger(t);
    }
  });

  ScriptApp.newTrigger('syncHealthConnect')
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.SUNDAY)
    .atHour(3)
    .create();

  Logger.log('Weekly trigger created: Sunday 3am');
}
