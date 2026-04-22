// Overpass API — OpenStreetMap data, completely free
// Rate limit: ~2 req/sec, so we batch carefully
const OVERPASS_URL = 'https://overpass-api.de/api/interpreter'
const NOMINATIM = 'https://nominatim.openstreetmap.org'

async function overpassQuery(query) {
  try {
    const res = await fetch(OVERPASS_URL, {
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

// Sample evenly-spaced points along the route for tiled queries
// Dynamically calculates count based on route extent to ensure full coverage
function sampleRoutePoints(geometry, pad) {
  const coords = geometry.coordinates
  // Calculate route extent in degrees
  let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity
  for (const [lng, lat] of coords) {
    if (lng < minLng) minLng = lng
    if (lng > maxLng) maxLng = lng
    if (lat < minLat) minLat = lat
    if (lat > maxLat) maxLat = lat
  }
  const extent = Math.max(maxLng - minLng, maxLat - minLat)
  // Each tile covers 2*pad degrees, overlap by 50% for full coverage
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

// Fetch ALL data (road stations, campsites, EV chargers) in one combined query per tile
// This minimizes Overpass requests
export async function fetchAllAlongRoute(geometry) {
  const pad = 0.4 // ~40km radius per tile
  const points = sampleRoutePoints(geometry, pad)
  const seen = new Set()

  const allRoadStations = []
  const allCampsites = []
  const allChargers = []

  // Query tiles in pairs (2 parallel) with 2s delay between batches
  for (let i = 0; i < points.length; i += 2) {
    if (i > 0) await new Promise((r) => setTimeout(r, 2000))

    const batch = points.slice(i, i + 2)
    const results = await Promise.all(
      batch.map(([pLng, pLat]) => {
        const bb = `(${pLat - pad},${pLng - pad},${pLat + pad},${pLng + pad})`
        const query = `
          [out:json][timeout:15];
          (
            way["highway"="services"]${bb};
            node["highway"="services"]${bb};
            way["highway"="rest_area"]${bb};
            node["highway"="rest_area"]${bb};
            node["tourism"="camp_site"]${bb};
            node["tourism"="caravan_site"]${bb};
            node["amenity"="charging_station"]${bb};
          );
          out center body;
        `
        return overpassQuery(query)
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
          const isRealStation = el.type === 'way' || el.type === 'relation'
            || /道の駅|[SsPp][Aa]$|サービスエリア|パーキングエリア/.test(name)
          if (isRealStation) {
            allRoadStations.push(parseRoadStation(el, elLat, elLng, tags))
          }
        } else if (tags.tourism === 'camp_site' || tags.tourism === 'caravan_site') {
          allCampsites.push(parseCampsite(el, elLat, elLng, tags))
        } else if (tags.amenity === 'charging_station') {
          allChargers.push(parseCharger(el, elLat, elLng, tags))
        }
      }
    }
  }

  // Cross-reference: tag road stations with nearby EV chargers
  const taggedStations = tagStationsWithChargers(allRoadStations, allChargers)

  return {
    roadStations: taggedStations,
    campsites: allCampsites,
    chargers: allChargers,
  }
}

function parseRoadStation(el, lat, lng, tags) {
  const name = tags.name || tags['name:ja'] || tags['name:en']
  const isMichinoeki = name?.includes('道の駅')

  const address = tags['addr:full']
    || [
        tags['addr:province'] || tags['addr:state'],
        tags['addr:city'],
        tags['addr:street'],
        tags['addr:housenumber'],
      ].filter(Boolean).join(' ')
    || null

  return {
    id: el.id,
    lat,
    lng,
    name: name || (isMichinoeki ? '道の駅' : 'Service Area'),
    subtype: isMichinoeki ? 'michinoeki' : 'service_area',
    address,
    operator: tags.operator,
    website: tags.website,
    openingHours: tags.opening_hours,
  }
}

function parseCampsite(el, lat, lng, tags) {
  return {
    id: el.id,
    lat,
    lng,
    name: tags.name || 'Campsite',
    type: tags.tourism || 'camp_site',
    website: tags.website,
  }
}

function parseCharger(el, lat, lng, tags) {
  const hasChademo = !!tags['socket:chademo']
  const hasCCS = !!tags['socket:type2_combo'] || !!tags['socket:type2_combo_2']
  const hasType2 = !!tags['socket:type2']
  const outputKw = tags['charging_station:output']
    ? parseInt(tags['charging_station:output'])
    : null
  const isQuick = hasChademo || hasCCS || (outputKw && outputKw >= 20)

  return {
    id: el.id,
    lat,
    lng,
    name: tags.name || tags.operator || 'EV Charger',
    operator: tags.operator,
    chademo: hasChademo,
    ccs: hasCCS,
    type2: hasType2,
    quick: isQuick,
  }
}

// Tag road stations with nearby EV charger info (within ~800m)
function tagStationsWithChargers(stations, chargers) {
  return stations.map((station) => {
    let nearest = null
    let nearestDist = Infinity
    for (const c of chargers) {
      const dx = c.lng - station.lng
      const dy = c.lat - station.lat
      const d = Math.sqrt(dx * dx + dy * dy)
      if (d < nearestDist) {
        nearestDist = d
        nearest = c
      }
    }
    const hasCharger = nearest && nearestDist < 0.008
    return {
      ...station,
      evCharger: hasCharger ? nearest : null,
    }
  })
}

// Reverse-geocode stations without addresses (sequential, rate-limited)
export async function fillMissingAddresses(stations) {
  const needAddress = stations.filter((s) => !s.address).slice(0, 10)
  for (let i = 0; i < needAddress.length; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, 1200))
    try {
      const url = `${NOMINATIM}/reverse?lat=${needAddress[i].lat}&lon=${needAddress[i].lng}&format=json&zoom=16&accept-language=ja`
      const res = await fetch(url)
      if (!res.ok) continue
      const data = await res.json()
      const a = data.address
      if (a) {
        needAddress[i].address = [
          a.province || a.state,
          a.city || a.town || a.village,
          a.suburb || a.neighbourhood,
          a.road,
        ].filter(Boolean).join(' ')
      }
    } catch {
      // skip
    }
  }
  return stations
}
