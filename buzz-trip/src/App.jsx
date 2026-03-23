import { useState, useCallback } from 'react'
import './App.css'
import Sidebar from './components/Sidebar.jsx'
import MapView from './components/MapView.jsx'
import { geocode, getRoute, planChargingStops, coordAtDistance } from './services/routing.js'
import { fetchAllAlongRoute, fillMissingAddresses } from './services/camping.js'

export default function App() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [selectedStopIdx, setSelectedStopIdx] = useState(null)
  const [tripPlan, setTripPlan] = useState(null)

  const handlePlan = async (startQuery, endQuery, startCharge) => {
    setLoading(true)
    setError(null)
    setTripPlan(null)

    try {
      // 1. Geocode start + end (sequential — Nominatim allows 1 req/sec)
      const startPlace = await geocode(startQuery)
      await new Promise((r) => setTimeout(r, 1100))
      const endPlace = await geocode(endQuery)

      // 2. Get driving route
      const route = await getRoute(startPlace, endPlace)

      // 3. Plan charging stops with battery simulation
      const { stops: chargingStopDefs, batteryAtDest } = planChargingStops(
        route.distanceKm,
        startCharge,
      )

      // 4. Build charging stop entries with coordinates
      const chargerResults = chargingStopDefs.map((stopDef) => {
        const coord = coordAtDistance(route.geometry, stopDef.distanceFromStart)
        return {
          type: 'charge',
          distanceFromStart: stopDef.distanceFromStart,
          coords: coord,
          batteryArrival: stopDef.batteryArrival,
          batteryDepart: stopDef.batteryDepart,
        }
      })

      // 5. Fetch all POIs along route in one combined pass (road stations, campsites, EV chargers)
      const { roadStations, campsites, chargers } = await fetchAllAlongRoute(route.geometry)

      // Match nearest EV charger to each charging stop
      for (const stop of chargerResults) {
        let nearest = null
        let nearestDist = Infinity
        for (const c of chargers) {
          const dx = c.lng - stop.coords[0]
          const dy = c.lat - stop.coords[1]
          const d = Math.sqrt(dx * dx + dy * dy)
          if (d < nearestDist) { nearestDist = d; nearest = c }
        }
        stop.charger = nearest
      }

      const campStops = pickCampStops(campsites, route, chargingStopDefs)
      const roadStationStops = snapStationsToRoute(roadStations, route.geometry, route.distanceKm)

      // 6. Build ordered trip plan
      const stops = [
        { type: 'start', name: startPlace.name, coords: [startPlace.lng, startPlace.lat], battery: startCharge },
        ...mergeAndSort(chargerResults, campStops, roadStationStops),
        { type: 'end', name: endPlace.name, coords: [endPlace.lng, endPlace.lat], battery: batteryAtDest },
      ]

      const plan = {
        distanceKm: route.distanceKm,
        durationMin: route.durationMin,
        geometry: route.geometry,
        startCharge,
        batteryAtDest,
        stops,
      }
      setTripPlan(plan)

      // Fill addresses in background (don't block UI)
      fillMissingAddresses(roadStations).then(() => {
        setTripPlan({ ...plan, stops: [...stops] })
      })
    } catch (err) {
      console.error(err)
      setError(err.message || 'Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const handleSelectStop = useCallback((idx) => {
    setSelectedStopIdx((prev) => (prev === idx ? null : idx))
  }, [])

  return (
    <div className="app">
      <Sidebar onPlan={handlePlan} loading={loading} tripPlan={tripPlan} error={error} selectedStopIdx={selectedStopIdx} onSelectStop={handleSelectStop} />
      <MapView tripPlan={tripPlan} selectedStopIdx={selectedStopIdx} />
    </div>
  )
}

// Pick 1 campsite per overnight stop
function pickCampStops(campsites, route, chargingStopDefs) {
  if (!campsites.length) return []

  const overnightDistances = []
  let d = 250
  while (d < route.distanceKm - 50) {
    overnightDistances.push(d)
    d += 300
  }

  return overnightDistances.map((targetDist) => {
    const coord = coordAtDistance(route.geometry, targetDist)
    let best = null
    let bestDist = Infinity
    for (const site of campsites) {
      const dx = site.lng - coord[0]
      const dy = site.lat - coord[1]
      const dist = Math.sqrt(dx * dx + dy * dy)
      if (dist < bestDist) {
        bestDist = dist
        best = site
      }
    }
    return { type: 'camp', distanceFromStart: targetDist, site: best }
  }).filter((s) => s.site)
}

// Snap road stations to nearest point on route
function snapStationsToRoute(stations, geometry, totalDistKm) {
  const coords = geometry.coordinates
  return stations.map((station) => {
    let minDist = Infinity
    let closestIdx = 0
    for (let i = 0; i < coords.length; i++) {
      const dx = coords[i][0] - station.lng
      const dy = coords[i][1] - station.lat
      const d = dx * dx + dy * dy
      if (d < minDist) { minDist = d; closestIdx = i }
    }
    if (Math.sqrt(minDist) > 0.05) return null

    let dist = 0
    for (let i = 1; i <= closestIdx; i++) {
      dist += haversineKm(coords[i - 1], coords[i])
    }
    return { type: 'road_station', distanceFromStart: dist, station }
  }).filter(Boolean)
}

function haversineKm([lng1, lat1], [lng2, lat2]) {
  const R = 6371
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLng = ((lng2 - lng1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function mergeAndSort(chargeStops, campStops, roadStationStops) {
  return [...chargeStops, ...campStops, ...roadStationStops].sort(
    (a, b) => a.distanceFromStart - b.distanceFromStart
  )
}
