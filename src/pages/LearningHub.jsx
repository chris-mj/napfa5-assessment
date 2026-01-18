const STATIONS = [
  {
    id: "situps",
    name: "Sit-ups",
    measures: "Core endurance and trunk control.",
    technique: [
      "Neutral neck, eyes up; hands cup the ears.",
      "Shoulders and upper back touch the mat on the way down.",
      "Elbows reach the knees at the top.",
      "Feet stay anchored; hips remain stable.",
    ],
    drills: [
      "Timed sets: 20s on, 10s off for 6 rounds.",
      "Slow eccentrics (going down): 3 seconds down each rep.",
      "Isometric (top holds) for 5-10 seconds.",
    ],
    mistakes: [
      "Partial reps (shoulders not touching the mat).",
      "Yanking the neck with hands.",
      "Feet lifting or sliding.",
    ],
    observerCues: [
      "Check shoulder blades touch the mat each rep.",
      "Confirm elbows reach the knees/marker.",
      "Count only full reps and call out no-rep clearly.",
    ],
    studentCues: [
      "Exhale on the way up, inhale down.",
      "Drive ribs toward hips.",
      "Keep chin off chest.",
    ],
  },
  {
    id: "pullups",
    name: "Pull-ups",
    measures: "Upper body pulling strength and endurance.",
    technique: [
      "Full hang at the bottom before each rep.",
      "Chin clears the bar at the top.",
      "Controlled lowering, no swinging.",
    ],
    drills: [
      "Scapular pull-ups for activation.",
      "Assisted pull-ups with bands.",
      "Negative reps: jump up, 3-5 seconds down.",
    ],
    mistakes: [
      "Half reps (chin not above bar or arms not straight).",
      "Kipping or swinging.",
      "Shrugging shoulders instead of pulling.",
    ],
    observerCues: [
      "Confirm full hang and chin-over-bar.",
      "Stop the set if excessive swinging appears.",
      "Count only strict reps.",
    ],
    studentCues: [
      "Pull elbows down to ribs.",
      "Chest up, shoulders away from ears.",
      "Keep body tight and straight.",
    ],
  },
  {
    id: "broad_jump",
    name: "Standing Broad Jump",
    measures: "Explosive lower-body power.",
    technique: [
      "Feet shoulder-width, two-foot takeoff and landing.",
      "Squat and swing arms back then forward for momentum.",
      "Land softly with knees bent and stable.",
    ],
    drills: [
      "60%-80% power jumps focusing on landing control.",
      "Box jumps for power.",
      "Broad jump with stick landing.",
    ],
    mistakes: [
      "Stepping or falling forward on landing.",
      "Not squatting more or swinging hard enough.",
      "Not using arm swing or swinging too many times.",
    ],
    observerCues: [
      "Measure from the back of the heels.",
      "Invalidate if feet move after landing.",
      "Ensure both feet leave and land together.",
    ],
    studentCues: [
      "Swing arms hard and drive hips forward.",
      "Land quiet and stable.",
      "Keep eyes forward.",
    ],
  },
  {
    id: "sit_and_reach",
    name: "Sit and Reach",
    measures: "Hamstring and lower back flexibility.",
    technique: [
      "Legs straight, feet flat against the box.",
      "Hands stacked, reach slowly and steadily.",
      "Hold the farthest point briefly.",
    ],
    drills: [
      "Dynamic hamstring swings.",
      "Seated hamstring stretches with long exhales.",
      "Partner-assisted stretches.",
    ],
    mistakes: [
      "Bouncing at end range.",
      "Bending knees to gain distance.",
      "Jerking to reach.",
    ],
    observerCues: [
      "Confirm knees stay straight.",
      "Measure at the farthest held position.",
      "No bouncing.",
    ],
    studentCues: [
      "Exhale and reach longer.",
      "Keep knees pressed down.",
      "Slow and controlled.",
    ],
  },
  {
    id: "shuttle_run",
    name: "Shuttle Run 4x10m",
    measures: "Agility, acceleration, and change of direction.",
    technique: [
      "Explode out of the start with low body angle.",
      "Pick up the block in a lunge position while facing in the opposite direction.",
      "Plant outside foot and push back immediately.",
    ],
    drills: [
      "5-10-5 shuttle drills.",
      "Line touch repeats with quick turns.",
      "Acceleration sprints over 10m.",
    ],
    mistakes: [
      "Standing tall before the turn.",
      "Slowing down at the finish line.",
      "Poor turning technique.",
        "Running in a curve.",
    ],
    observerCues: [
      "Swing arms and power steps",
      "Good turning technique.",
      "Ensure safe surface and footwear.",
    ],
    studentCues: [
      "Stay low through the turn.",
      "Use short, quick steps at the line.",
      "Drive out hard after the turn.",
    ],
  },
  {
    id: "run",
    name: "1.6/2.4km Run",
    measures: "Cardiovascular endurance.",
    technique: [
      "Even pacing from the start; avoid sprinting early.",
      "Relaxed shoulders, compact arm swing.",
      "Consistent stride, steady breathing rhythm.",
    ],
    drills: [
      "Interval repeats: 400m at race pace, 200m jog.",
      "Tempo runs: 8-12 minutes at steady effort.",
      "Cadence work: short fast strides.",
    ],
    mistakes: [
      "Starting too fast and fading.",
      "Overstriding and heel strikes first, heel braking.",
      "Holding breath under fatigue.",
    ],
    observerCues: [
      "Track splits each lap for pacing.",
      "Confirm clear route and timing method.",
      "Encourage steady effort and safety.",
    ],
    studentCues: [
      "Set a target split and stick to it.",
      "Run tall, relax the shoulders.",
      "Focus on smooth breathing.",
    ],
  },
  {
    id: "pushups",
    name: "Push-ups",
    measures: "Upper body endurance and core stability.",
    technique: [
      "Body in a straight line from head to heels.",
      "Elbows track about 45 degrees from the body.",
      "Chest reaches the target depth each rep.",
      "Full lockout at the top.",
    ],
    drills: [
      "Incline push-ups to build volume.",
      "Tempo sets: 2 seconds down, 1 second up.",
      "Plank to push-up transitions.",
    ],
    mistakes: [
      "Sagging hips or raised hips.",
      "Partial depth reps.",
      "Elbows flaring too wide.",
    ],
    observerCues: [
      "Check straight body line.",
      "Confirm chest reaches depth standard.",
      "Count only full lockout reps.",
    ],
    studentCues: [
      "Squeeze glutes and brace core.",
      "Press the floor away.",
      "Keep shoulders down and back.",
    ],
  },
];

function StationSection({ station }) {
  return (
    <details className="border rounded-lg bg-white shadow-sm p-4">
      <summary className="text-lg font-semibold cursor-pointer">{station.name}</summary>
      <div className="mt-3 space-y-3">
        <div className="border border-dashed rounded-md p-4 text-center text-xs text-gray-500 bg-gray-50">
          Media placeholder: add GIF or step-by-step frames here.
        </div>
        <div className="text-sm text-gray-700">
          <div className="font-medium mb-1">What it measures</div>
          <div>{station.measures}</div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-3 text-sm">
            <div>
              <div className="font-medium mb-1">Technique checklist</div>
              <ul className="list-disc pl-5 space-y-1">
                {station.technique.map((t) => (<li key={t}>{t}</li>))}
              </ul>
            </div>
            <div>
              <div className="font-medium mb-1">Drills library</div>
              <ul className="list-disc pl-5 space-y-1">
                {station.drills.map((t) => (<li key={t}>{t}</li>))}
              </ul>
            </div>
            <div>
              <div className="font-medium mb-1">Common mistakes</div>
              <ul className="list-disc pl-5 space-y-1">
                {station.mistakes.map((t) => (<li key={t}>{t}</li>))}
              </ul>
            </div>
          </div>
          <div className="space-y-3 text-sm">
            <div>
              <div className="font-medium mb-1">Observer cues</div>
              <ul className="list-disc pl-5 space-y-1">
                {station.observerCues.map((t) => (<li key={t}>{t}</li>))}
              </ul>
            </div>
            <div>
              <div className="font-medium mb-1">Student cues</div>
              <ul className="list-disc pl-5 space-y-1">
                {station.studentCues.map((t) => (<li key={t}>{t}</li>))}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </details>
  );
}

export default function LearningHub() {
  return (
    <main className="w-full">
      <div className="max-w-5xl mx-auto px-4 py-6 space-y-4">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold">Learning Hub</h1>
          <p className="text-sm text-gray-600">Coaching notes and cue cards for each station.</p>
        </header>
        <section className="space-y-4">
          {STATIONS.map((s) => (<StationSection key={s.id} station={s} />))}
        </section>
      </div>
    </main>
  );
}
