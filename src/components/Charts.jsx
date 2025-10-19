
import React from 'react'
import { Line } from 'react-chartjs-2'
import { Chart, registerables } from 'chart.js'
Chart.register(...registerables)

export default function Charts({scores}){
  const dates = scores.map(s => s.test_date)
  const runValues = scores.map(s => s.run_2400)
  const situps = scores.map(s => s.situps)

  const data = {
    labels: dates,
    datasets: [
      { label: '2.4km (min)', data: runValues, tension: 0.2 },
      { label: 'Sit-ups', data: situps, tension: 0.2 }
    ]
  }

  return (
    <div className="p-4 bg-white rounded shadow">
      <h3 className="font-semibold mb-2">Progress</h3>
      <Line data={data} />
    </div>
  )
}
