export async function getHeartRateTool(
  db: D1Database,
  startDate: string,
  endDate: string
): Promise<string> {
  const { results } = await db
    .prepare(
      `SELECT date, min_bpm, avg_bpm, max_bpm, sample_count
       FROM heart_rate_record_series_table
       WHERE date >= ? AND date <= ? ORDER BY date`
    )
    .bind(startDate, endDate)
    .all<Record<string, unknown>>();
  if (!results.length) return `No heart rate data from ${startDate} to ${endDate}.`;
  return JSON.stringify(results, null, 2);
}

export async function getStepsTool(
  db: D1Database,
  startDate: string,
  endDate: string
): Promise<string> {
  const { results } = await db
    .prepare(
      `SELECT local_date, SUM(count) as total_steps
       FROM steps_record_table
       WHERE local_date >= ? AND local_date <= ?
       GROUP BY local_date ORDER BY local_date`
    )
    .bind(startDate, endDate)
    .all<Record<string, unknown>>();
  if (!results.length) return `No step data from ${startDate} to ${endDate}.`;
  return JSON.stringify(results, null, 2);
}

export async function getSleepTool(
  db: D1Database,
  startDate: string,
  endDate: string
): Promise<string> {
  const { results } = await db
    .prepare(
      `SELECT s.local_date, s.start_time, s.end_time, s.title, s.notes,
              GROUP_CONCAT(st.stage_type || ':' || st.stage_start_time || '-' || st.stage_end_time) as stages
       FROM sleep_session_record_table s
       LEFT JOIN sleep_stages_table st ON st.parent_key = s.row_id
       WHERE s.local_date >= ? AND s.local_date <= ?
       GROUP BY s.row_id ORDER BY s.local_date`
    )
    .bind(startDate, endDate)
    .all<Record<string, unknown>>();
  if (!results.length) return `No sleep data from ${startDate} to ${endDate}.`;
  return JSON.stringify(results, null, 2);
}

export async function getWorkoutsTool(
  db: D1Database,
  startDate: string,
  endDate: string
): Promise<string> {
  const { results } = await db
    .prepare(
      `SELECT e.local_date, e.start_time, e.end_time, e.exercise_type, e.title, e.notes,
              d.distance
       FROM exercise_session_record_table e
       LEFT JOIN distance_record_table d ON d.local_date = e.local_date
       WHERE e.local_date >= ? AND e.local_date <= ? ORDER BY e.local_date`
    )
    .bind(startDate, endDate)
    .all<Record<string, unknown>>();
  if (!results.length) return `No workout data from ${startDate} to ${endDate}.`;
  return JSON.stringify(results, null, 2);
}

export async function getNutritionTool(
  db: D1Database,
  startDate: string,
  endDate: string
): Promise<string> {
  const { results } = await db
    .prepare(
      `SELECT local_date,
              SUM(energy) as total_calories,
              SUM(protein) as total_protein,
              SUM(total_carbohydrate) as total_carbs,
              SUM(total_fat) as total_fat,
              SUM(sugar) as total_sugar,
              SUM(dietary_fiber) as total_fiber
       FROM nutrition_record_table
       WHERE local_date >= ? AND local_date <= ?
       GROUP BY local_date ORDER BY local_date`
    )
    .bind(startDate, endDate)
    .all<Record<string, unknown>>();
  if (!results.length) return `No nutrition data from ${startDate} to ${endDate}.`;
  return JSON.stringify(results, null, 2);
}

export async function getWeightTool(
  db: D1Database,
  startDate: string,
  endDate: string
): Promise<string> {
  const { results } = await db
    .prepare(
      `SELECT w.local_date, w.weight,
              bf.percentage as body_fat_pct,
              bwm.body_water_mass,
              bm.mass as bone_mass,
              bmr.basal_metabolic_rate
       FROM weight_record_table w
       LEFT JOIN body_fat_record_table bf ON bf.local_date = w.local_date
       LEFT JOIN body_water_mass_record_table bwm ON bwm.local_date = w.local_date
       LEFT JOIN bone_mass_record_table bm ON bm.local_date = w.local_date
       LEFT JOIN basal_metabolic_rate_record_table bmr ON bmr.local_date = w.local_date
       WHERE w.local_date >= ? AND w.local_date <= ? ORDER BY w.local_date`
    )
    .bind(startDate, endDate)
    .all<Record<string, unknown>>();
  if (!results.length) return `No weight data from ${startDate} to ${endDate}.`;
  return JSON.stringify(results, null, 2);
}

export async function getHealthSummaryTool(
  db: D1Database,
  startDate: string,
  endDate: string
): Promise<string> {
  const [steps, weight, sleep, hr] = await Promise.all([
    db
      .prepare(
        `SELECT AVG(total_steps) as avg_steps FROM
         (SELECT SUM(count) as total_steps FROM steps_record_table
          WHERE local_date >= ? AND local_date <= ? GROUP BY local_date)`
      )
      .bind(startDate, endDate)
      .all<{ avg_steps: number }>(),
    db
      .prepare(
        `SELECT AVG(weight) as avg_weight FROM weight_record_table
         WHERE local_date >= ? AND local_date <= ?`
      )
      .bind(startDate, endDate)
      .all<{ avg_weight: number }>(),
    db
      .prepare(
        `SELECT COUNT(*) as sessions FROM sleep_session_record_table
         WHERE local_date >= ? AND local_date <= ?`
      )
      .bind(startDate, endDate)
      .all<{ sessions: number }>(),
    db
      .prepare(
        `SELECT AVG(avg_bpm) as avg_hr FROM heart_rate_record_series_table
         WHERE date >= ? AND date <= ?`
      )
      .bind(startDate, endDate)
      .all<{ avg_hr: number }>(),
  ]);

  return JSON.stringify(
    {
      period: { from: startDate, to: endDate },
      avg_daily_steps: steps.results[0]?.avg_steps ?? null,
      avg_weight_kg: weight.results[0]?.avg_weight ?? null,
      sleep_sessions: sleep.results[0]?.sessions ?? null,
      avg_heart_rate_bpm: hr.results[0]?.avg_hr ?? null,
    },
    null,
    2
  );
}
