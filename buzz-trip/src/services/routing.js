const NOMINATIM = 'https://nominatim.openstreetmap.org'
const OSRM = 'https://router.project-osrm.org'

// ID. Buzz battery model
export const ID_BUZZ_RANGE_KM = 460 // ID. Buzz Pro Long Range at 100%
const KM_PER_PERCENT = ID_BUZZ_RANGE_KM / 100 // 2.2 km per %
const MIN_CHARGE = 20 // stop to charge when hitting 20%
const CHARGE_TO = 80 // charge up to 80% (fast charge sweet spot)

export async function geocode(query) {
  // Nominatim accepts city names and full addresses
  const url = `${NOMINATIM}/search?q=${encodeURIComponent(query)}&format=json&limit=1&accept-language=en`

  // Retry with backoff if rate-limited (429)
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, 1500 * attempt))
    }
    const res = await fetch(url)
    if (res.status === 429) continue
    if (!res.ok) throw new Error(`Geocoding failed (${res.status})`)
    const data = await res.json()
    if (!data.length) throw new Error(`Could not find "${query}" — try a more specific name or address`)
    return {
      lng: parseFloat(data[0].lon),
      lat: parseFloat(data[0].lat),
      name: data[0].display_name,
    }
  }
  throw new Error('Geocoding rate-limited — please wait a moment and try again')
}

export async function getRoute(start, end) {
  const coords = `${start.lng},${start.lat};${end.lng},${end.lat}`
  const url = `${OSRM}/route/v1/driving/${coords}?geometries=geojson&overview=full`
  let res
  try {
    res = await fetch(url)
  } catch (e) {
    throw new Error('Could not reach routing server — check your internet connection')
  }
  if (!res.ok) throw new Error(`Routing failed (${res.status})`)
  const data = await res.json()
  if (data.code !== 'Ok' || !data.routes?.length) throw new Error('No driving route found between these locations')
  const route = data.routes[0]
  return {
    geometry: route.geometry,
    distanceKm: route.distance / 1000,
    durationMin: route.duration / 60,
  }
}

// Plan charging stops with realistic battery simulation
// Returns stops with batteryArrival and batteryDepart for each
export function planChargingStops(distanceKm, startCharge) {
  const stops = []
  let battery = startCharge
  let driven = 0
  let stopNum = 1

  // How far can we go with current battery before hitting MIN_CHARGE?
  const rangeLeft = () => (battery - MIN_CHARGE) * KM_PER_PERCENT

  while (driven + rangeLeft() < distanceKm) {
    driven += rangeLeft()
    const batteryArrival = MIN_CHARGE
    stops.push({
      distanceFromStart: driven,
      stopNum: stopNum++,
      batteryArrival,
      batteryDepart: CHARGE_TO,
    })
    battery = CHARGE_TO
  }

  // Battery at destination
  const remainingKm = distanceKm - driven
  const batteryAtDest = Math.round(battery - remainingKm / KM_PER_PERCENT)

  return { stops, batteryAtDest }
}

// Charge % → estimated range in km
export function chargeToRange(chargePercent) {
  return Math.round(chargePercent * KM_PER_PERCENT)
}

export function coordAtDistance(geometry, targetKm) {
  const coords = geometry.coordinates
  let accumulated = 0
  for (let i = 1; i < coords.length; i++) {
    const seg = haversineKm(coords[i - 1], coords[i])
    if (accumulated + seg >= targetKm) {
      const t = (targetKm - accumulated) / seg
      return [
        coords[i - 1][0] + t * (coords[i][0] - coords[i - 1][0]),
        coords[i - 1][1] + t * (coords[i][1] - coords[i - 1][1]),
      ]
    }
    accumulated += seg
  }
  return coords[coords.length - 1]
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
