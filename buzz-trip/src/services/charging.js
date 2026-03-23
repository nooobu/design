// Open Charge Map API — free, no key required for basic use
// https://openchargemap.org/site/develop/api

const OCM_BASE = '/api/ocm/v3'

// Find CCS2 / Type 2 chargers near a [lng, lat] point
export async function findChargers(lng, lat, radiusKm = 15) {
  const params = new URLSearchParams({
    output: 'json',
    latitude: lat,
    longitude: lng,
    distance: radiusKm,
    distanceunit: 'km',
    maxresults: 5,
    compact: true,
    verbose: false,
    // ConnectionTypeID 25 = Type 2 (Mennekes), 33 = CCS Type 2 (ID. Buzz compatible)
    connectiontypeid: '25,33',
  })

  const res = await fetch(`${OCM_BASE}/poi/?${params}`)
  if (!res.ok) return []
  const data = await res.json()

  return data.map((station) => ({
    id: station.ID,
    name: station.AddressInfo?.Title || 'Charging Station',
    address: [
      station.AddressInfo?.AddressLine1,
      station.AddressInfo?.Town,
    ]
      .filter(Boolean)
      .join(', '),
    lat: station.AddressInfo?.Latitude,
    lng: station.AddressInfo?.Longitude,
    maxKw: station.Connections?.[0]?.PowerKW || null,
    network: station.OperatorInfo?.Title || 'Unknown',
    numPoints: station.NumberOfPoints || 1,
  })).filter((s) => s.lat && s.lng)
}
