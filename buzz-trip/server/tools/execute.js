// Tool execution — calls external APIs (OSRM, Nominatim, Overpass)
// Ported from the frontend services

const NOMINATIM = 'https://nominatim.openstreetmap.org'
const OSRM = 'https://router.project-osrm.org'
const OVERPASS = 'https://overpass-api.de/api/interpreter'

// ID. Buzz Pro Long Range
const RANGE_KM = 460
const KM_PER_PERCENT = RANGE_KM / 100
const MIN_CHARGE = 20
const CHARGE_TO = 80

// --- Geocoding ---
async function geocode(query) {
  const url = `${NOMINATIM}/search?q=${encodeURIComponent(query)}&format=json&limit=1&accept-language=ja`
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await sleep(1500 * attempt)
    const res = await fetch(url, {
      headers: { 'User-Agent': 'BuzzTrip/1.0 (EV trip planner prototype)' },
    })
    if (res.status === 429) continue
    if (!res.ok) throw new Error(`Geocoding failed (${res.status})`)
    const data = await res.json()
    if (!data.length) throw new Error(`場所が見つかりません: "${query}"`)
    return {
      lat: parseFloat(data[0].lat),
      lng: parseFloat(data[0].lon),
      name: data[0].display_name,
    }
  }
  throw new Error('Geocoding rate limited')
}

// --- Routing ---
async function getRoute(start, end) {
  const coords = `${start.lng},${start.lat};${end.lng},${end.lat}`
  const url = `${OSRM}/route/v1/driving/${coords}?geometries=geojson&overview=full`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Routing failed (${res.status})`)
  const data = await res.json()
  if (data.code !== 'Ok' || !data.routes?.length) throw new Error('ルートが見つかりません')
  const route = data.routes[0]
  return {
    geometry: route.geometry,
    distanceKm: route.distance / 1000,
    durationMin: route.duration / 60,
  }
}

// --- Battery simulation ---
function planChargingStops(distanceKm, startCharge = 80) {
  const stops = []
  let battery = startCharge
  let driven = 0
  let stopNum = 1
  const rangeLeft = () => (battery - MIN_CHARGE) * KM_PER_PERCENT

  while (driven + rangeLeft() < distanceKm) {
    driven += rangeLeft()
    stops.push({
      distanceFromStart: driven,
      stopNum: stopNum++,
      batteryArrival: MIN_CHARGE,
      batteryDepart: CHARGE_TO,
    })
    battery = CHARGE_TO
  }

  const remainingKm = distanceKm - driven
  const batteryAtDest = Math.round(battery - remainingKm / KM_PER_PERCENT)
  return { stops, batteryAtDest }
}

// --- Overpass queries ---
async function overpassQuery(query) {
  try {
    const res = await fetch(OVERPASS, {
      method: 'POST',
      body: `data=${encodeURIComponent(query)}`,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    })
    if (!res.ok) return []
    const data = await res.json()
    return data.elements || []
  } catch {
    return []
  }
}

function sampleRoutePoints(geometry, pad) {
  const coords = geometry.coordinates
  let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity
  for (const [lng, lat] of coords) {
    if (lng < minLng) minLng = lng
    if (lng > maxLng) maxLng = lng
    if (lat < minLat) minLat = lat
    if (lat > maxLat) maxLat = lat
  }
  const extent = Math.max(maxLng - minLng, maxLat - minLat)
  const count = Math.max(3, Math.ceil(extent / pad))
  if (coords.length <= count) return coords
  const step = Math.max(1, Math.floor(coords.length / count))
  const points = []
  for (let i = 0; i < coords.length; i += step) {
    points.push(coords[i])
  }
  if (points[points.length - 1] !== coords[coords.length - 1]) {
    points.push(coords[coords.length - 1])
  }
  return points
}

async function fetchPOIsAlongRoute(geometry, emitProgress) {
  const pad = 0.4
  const points = sampleRoutePoints(geometry, pad)
  const seen = new Set()
  const roadStations = []
  const campsites = []
  const chargers = []

  for (let i = 0; i < points.length; i += 2) {
    if (i > 0) await sleep(2000)
    if (emitProgress) emitProgress(`スポットを検索中... (${i + 1}/${points.length})`)

    const batch = points.slice(i, i + 2)
    const results = await Promise.all(
      batch.map(([pLng, pLat]) => {
        const bb = `(${pLat - pad},${pLng - pad},${pLat + pad},${pLng + pad})`
        return overpassQuery(`
          [out:json][timeout:15];
          (
            way["highway"="services"]${bb};
            node["highway"="services"]${bb};
            way["highway"="rest_area"]${bb};
            node["highway"="rest_area"]${bb};
            node["amenity"="charging_station"]${bb};
          );
          out center body;
        `)
      })
    )

    for (const elements of results) {
      for (const el of elements) {
        if (seen.has(el.id)) continue
        seen.add(el.id)
        const elLat = el.lat ?? el.center?.lat
        const elLng = el.lon ?? el.center?.lon
        if (!elLat || !elLng) continue
        const tags = el.tags || {}

        if (tags.highway === 'services' || tags.highway === 'rest_area') {
          const name = tags.name || tags['name:ja'] || ''
          const isReal = el.type === 'way' || el.type === 'relation'
            || /道の駅|[SsPp][Aa]$|サービスエリア|パーキングエリア/.test(name)
          if (isReal) {
            roadStations.push({
              lat: elLat, lng: elLng,
              name: name || 'Service Area',
              subtype: name.includes('道の駅') ? 'michinoeki' : 'service_area',
              address: tags['addr:full'] || [tags['addr:province'], tags['addr:city']].filter(Boolean).join(' ') || null,
            })
          }
        } else if (tags.amenity === 'charging_station') {
          const hasChademo = !!tags['socket:chademo']
          const hasCCS = !!tags['socket:type2_combo'] || !!tags['socket:type2_combo_2']
          chargers.push({
            lat: elLat, lng: elLng,
            name: tags.name || tags.operator || 'EV Charger',
            quick: hasChademo || hasCCS,
            chademo: hasChademo, ccs: hasCCS,
          })
        }
      }
    }
  }

  // Tag stations with nearby chargers
  for (const station of roadStations) {
    let nearest = null, nearestDist = Infinity
    for (const c of chargers) {
      const d = Math.sqrt((c.lng - station.lng) ** 2 + (c.lat - station.lat) ** 2)
      if (d < nearestDist) { nearestDist = d; nearest = c }
    }
    station.evCharger = nearest && nearestDist < 0.008 ? nearest : null
  }

  return { roadStations, chargers }
}

// Snap stations to route and calculate distance from start
function snapToRoute(stations, geometry) {
  const coords = geometry.coordinates
  return stations.map((s) => {
    let minD = Infinity, idx = 0
    for (let i = 0; i < coords.length; i++) {
      const d = (coords[i][0] - s.lng) ** 2 + (coords[i][1] - s.lat) ** 2
      if (d < minD) { minD = d; idx = i }
    }
    if (Math.sqrt(minD) > 0.05) return null
    let dist = 0
    for (let i = 1; i <= idx; i++) dist += haversineKm(coords[i - 1], coords[i])
    return { ...s, distanceFromStart: dist }
  }).filter(Boolean).sort((a, b) => a.distanceFromStart - b.distanceFromStart)
}

function coordAtDistance(geometry, targetKm) {
  const coords = geometry.coordinates
  let acc = 0
  for (let i = 1; i < coords.length; i++) {
    const seg = haversineKm(coords[i - 1], coords[i])
    if (acc + seg >= targetKm) {
      const t = (targetKm - acc) / seg
      return [
        coords[i - 1][0] + t * (coords[i][0] - coords[i - 1][0]),
        coords[i - 1][1] + t * (coords[i][1] - coords[i - 1][1]),
      ]
    }
    acc += seg
  }
  return coords[coords.length - 1]
}

function haversineKm([lng1, lat1], [lng2, lat2]) {
  const R = 6371
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLng = ((lng2 - lng1) * Math.PI) / 180
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

// --- Tool execution ---
export async function executeTool(name, input, emitProgress) {
  switch (name) {
    case 'plan_complete_trip': {
      const startCharge = input.start_charge_percent ?? 80

      if (emitProgress) emitProgress('出発地を検索中...')
      const startPlace = await geocode(input.departure)
      await sleep(1100)

      if (emitProgress) emitProgress('目的地を検索中...')
      const endPlace = await geocode(input.destination)

      if (emitProgress) emitProgress('ルートを計算中...')
      const route = await getRoute(startPlace, endPlace)

      if (emitProgress) emitProgress('充電計画を立案中...')
      const { stops: chargeDefs, batteryAtDest } = planChargingStops(route.distanceKm, startCharge)

      const chargeStops = chargeDefs.map((s) => {
        const coord = coordAtDistance(route.geometry, s.distanceFromStart)
        return {
          type: 'charge',
          distanceFromStart: s.distanceFromStart,
          coords: coord,
          batteryArrival: s.batteryArrival,
          batteryDepart: s.batteryDepart,
        }
      })

      if (emitProgress) emitProgress('道の駅・SAを検索中...')
      const { roadStations, chargers } = await fetchPOIsAlongRoute(route.geometry, emitProgress)

      // Match chargers to charge stops
      for (const stop of chargeStops) {
        let nearest = null, nearestDist = Infinity
        for (const c of chargers) {
          const d = Math.sqrt((c.lng - stop.coords[0]) ** 2 + (c.lat - stop.coords[1]) ** 2)
          if (d < nearestDist) { nearestDist = d; nearest = c }
        }
        stop.charger = nearest
      }

      const snappedStations = snapToRoute(roadStations, route.geometry)
      const roadStationStops = snappedStations.map((s) => ({
        type: 'road_station',
        distanceFromStart: s.distanceFromStart,
        station: s,
      }))

      const stops = [
        { type: 'start', name: startPlace.name, coords: [startPlace.lng, startPlace.lat], battery: startCharge },
        ...[...chargeStops, ...roadStationStops].sort((a, b) => a.distanceFromStart - b.distanceFromStart),
        { type: 'end', name: endPlace.name, coords: [endPlace.lng, endPlace.lat], battery: batteryAtDest },
      ]

      const tripPlan = {
        distanceKm: route.distanceKm,
        durationMin: route.durationMin,
        geometry: route.geometry,
        startCharge,
        batteryAtDest,
        stops,
      }

      // Summary for Claude (exclude large geometry)
      const summary = {
        distance: `${Math.round(route.distanceKm)} km`,
        duration: `${Math.floor(route.durationMin / 60)}時間${Math.round(route.durationMin % 60)}分`,
        chargingStops: chargeStops.length,
        roadStations: snappedStations.length,
        michinoeki: snappedStations.filter(s => s.subtype === 'michinoeki').length,
        saPa: snappedStations.filter(s => s.subtype === 'service_area').length,
        batteryAtDest: `${batteryAtDest}%`,
        stopsWithEV: snappedStations.filter(s => s.evCharger).map(s => s.name),
        topStops: snappedStations.slice(0, 10).map(s => ({
          name: s.name,
          type: s.subtype === 'michinoeki' ? '道の駅' : 'SA/PA',
          distKm: Math.round(s.distanceFromStart),
          hasEV: !!s.evCharger,
        })),
      }

      return { summary, tripPlan }
    }

    case 'find_rest_stops': {
      const pad = (input.radius_km || 30) / 111
      const bb = `(${input.lat - pad},${input.lng - pad},${input.lat + pad},${input.lng + pad})`
      const elements = await overpassQuery(`
        [out:json][timeout:15];
        (
          way["highway"="services"]${bb};
          node["highway"="services"]${bb};
          way["highway"="rest_area"]${bb};
          node["highway"="rest_area"]${bb};
        );
        out center body;
      `)
      const results = elements
        .map(el => {
          const lat = el.lat ?? el.center?.lat
          const lng = el.lon ?? el.center?.lon
          if (!lat || !lng) return null
          const name = el.tags?.name || el.tags?.['name:ja'] || ''
          const isReal = el.type === 'way' || el.type === 'relation'
            || /道の駅|[SsPp][Aa]$|サービスエリア|パーキングエリア/.test(name)
          if (!isReal) return null
          const isMichi = name.includes('道の駅')
          if (input.filter === 'michinoeki' && !isMichi) return null
          if (input.filter === 'sa_pa' && isMichi) return null
          return { name: name || 'Service Area', lat, lng, type: isMichi ? '道の駅' : 'SA/PA' }
        })
        .filter(Boolean)
      return results
    }

    case 'find_ev_chargers': {
      const pad = (input.radius_km || 15) / 111
      const bb = `(${input.lat - pad},${input.lng - pad},${input.lat + pad},${input.lng + pad})`
      const elements = await overpassQuery(`
        [out:json][timeout:15];
        node["amenity"="charging_station"]${bb};
        out body;
      `)
      return elements.map(el => ({
        name: el.tags?.name || el.tags?.operator || 'EV Charger',
        lat: el.lat, lng: el.lon,
        quick: !!(el.tags?.['socket:chademo'] || el.tags?.['socket:type2_combo']),
        chademo: !!el.tags?.['socket:chademo'],
        ccs: !!el.tags?.['socket:type2_combo'],
      }))
    }

    default:
      throw new Error(`Unknown tool: ${name}`)
  }
}
