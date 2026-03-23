import { useEffect, useRef } from 'react'
import L from 'leaflet'
import './MapView.css'

// Fix Leaflet default icon path issue with Vite
delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
})

const ROUTE_COLOR = '#00d4aa'
const CHARGE_COLOR = '#4fc3f7'
const CAMP_COLOR = '#81c784'
const ROAD_COLOR = '#ce93d8'

function makeIcon(emoji, color) {
  return L.divIcon({
    className: '',
    html: `<div class="map-marker" style="background:${color}">${emoji}</div>`,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
    popupAnchor: [0, -18],
  })
}

export default function MapView({ tripPlan, selectedStopIdx }) {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const layersRef = useRef([])
  const markersRef = useRef([]) // store markers by stop index
  const highlightRef = useRef(null)

  useEffect(() => {
    const map = L.map(containerRef.current, {
      center: [36.5, 137.5],
      zoom: 5,
      zoomControl: false,
    })
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map)
    L.control.zoom({ position: 'bottomright' }).addTo(map)
    mapRef.current = map
    return () => map.remove()
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    // Remove old layers
    layersRef.current.forEach((l) => l.remove())
    layersRef.current = []
    markersRef.current = []

    if (!tripPlan) return

    // Draw route
    const routeCoords = tripPlan.geometry.coordinates.map(([lng, lat]) => [lat, lng])
    const polyline = L.polyline(routeCoords, {
      color: ROUTE_COLOR,
      weight: 5,
      opacity: 0.85,
    }).addTo(map)
    layersRef.current.push(polyline)

    // Fit map to route
    map.fitBounds(polyline.getBounds(), { padding: [40, 40] })

    // Add markers
    tripPlan.stops.forEach((stop, idx) => {
      let latlng, marker

      if (stop.type === 'start') {
        latlng = [stop.coords[1], stop.coords[0]]
        marker = L.marker(latlng, { icon: makeIcon('🏠', '#00d4aa') })
          .bindPopup(popupHTML(stop))
      } else if (stop.type === 'end') {
        latlng = [stop.coords[1], stop.coords[0]]
        marker = L.marker(latlng, { icon: makeIcon('🏁', '#ffb74d') })
          .bindPopup(popupHTML(stop))
      } else if (stop.type === 'charge' && stop.charger) {
        latlng = [stop.charger.lat, stop.charger.lng]
        marker = L.marker(latlng, { icon: makeIcon('⚡', CHARGE_COLOR) })
          .bindPopup(popupHTML(stop))
      } else if (stop.type === 'charge' && stop.coords) {
        latlng = [stop.coords[1], stop.coords[0]]
        marker = L.marker(latlng, { icon: makeIcon('⚡', CHARGE_COLOR) })
          .bindPopup(popupHTML(stop))
      } else if (stop.type === 'camp' && stop.site) {
        latlng = [stop.site.lat, stop.site.lng]
        marker = L.marker(latlng, { icon: makeIcon('⛺', CAMP_COLOR) })
          .bindPopup(popupHTML(stop))
      } else if (stop.type === 'road_station' && stop.station) {
        const isMichi = stop.station.subtype === 'michinoeki'
        latlng = [stop.station.lat, stop.station.lng]
        marker = L.marker(latlng, { icon: makeIcon(isMichi ? '🏪' : '🛣️', ROAD_COLOR) })
          .bindPopup(popupHTML(stop))
      }

      if (marker) {
        marker.addTo(map)
        layersRef.current.push(marker)
      }
      markersRef.current[idx] = { marker, latlng }
    })
  }, [tripPlan])

  // Zoom to selected stop
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    // Remove previous highlight
    if (highlightRef.current) {
      highlightRef.current.remove()
      highlightRef.current = null
    }

    if (selectedStopIdx == null || !markersRef.current[selectedStopIdx]) return

    const { marker, latlng } = markersRef.current[selectedStopIdx]
    if (!latlng) return

    map.flyTo(latlng, 14, { duration: 0.8 })

    // Add pulsing highlight circle
    const highlight = L.circleMarker(latlng, {
      radius: 22,
      color: '#00d4aa',
      weight: 3,
      fillColor: '#00d4aa',
      fillOpacity: 0.15,
      className: 'highlight-pulse',
    }).addTo(map)
    highlightRef.current = highlight

    // Open popup
    if (marker) marker.openPopup()
  }, [selectedStopIdx])

  return <div ref={containerRef} className="map-container" />
}

function popupHTML(stop) {
  if (stop.type === 'start') {
    return `<div class="popup"><strong>Start</strong><p>${stop.name.split(',')[0]}</p></div>`
  }
  if (stop.type === 'end') {
    return `<div class="popup"><strong>Destination</strong><p>${stop.name.split(',')[0]}</p></div>`
  }
  if (stop.type === 'charge') {
    const c = stop.charger
    return `
      <div class="popup">
        <div class="popup-tag charge-tag">⚡ Charging Stop</div>
        <strong>${c?.name || 'Charging Station'}</strong>
        ${c?.address ? `<p>${c.address}</p>` : ''}
        ${c?.maxKw ? `<p>${c.maxKw} kW · ${c?.network || ''}</p>` : ''}
        <p>Arrive ~${stop.batteryArrival}% · Depart 80%</p>
      </div>
    `
  }
  if (stop.type === 'camp') {
    const s = stop.site
    return `
      <div class="popup">
        <div class="popup-tag camp-tag">⛺ Overnight</div>
        <strong>${s?.name || 'Campsite'}</strong>
        ${s?.type === 'caravan_site' ? '<p>Caravan / Van Site</p>' : '<p>Campsite</p>'}
        ${s?.electric ? '<p>EV hookup available</p>' : ''}
      </div>
    `
  }
  if (stop.type === 'road_station') {
    const s = stop.station
    const isMichi = s?.subtype === 'michinoeki'
    const ev = s?.evCharger
    const types = ev ? [ev.chademo && 'CHAdeMO', ev.ccs && 'CCS2', ev.type2 && 'Type 2'].filter(Boolean).join(' / ') : ''
    return `
      <div class="popup">
        <div class="popup-tag road-tag">${isMichi ? '🏪 道の駅' : '🛣️ Service Area'}</div>
        <strong>${s?.name || (isMichi ? '道の駅' : 'Service Area')}</strong>
        ${s?.address ? `<p>${s.address}</p>` : ''}
        ${isMichi ? '<p>Overnight parking OK</p>' : '<p>Highway SA / PA</p>'}
        ${ev ? `<p style="color:#4fc3f7">${ev.quick ? '⚡ Quick Charge' : '🔌 EV Charging'}${types ? ' · ' + types : ''}</p>` : ''}
        ${s?.operator ? `<p>${s.operator}</p>` : ''}
      </div>
    `
  }
  return ''
}
