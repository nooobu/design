import { useState } from 'react'
import { chargeToRange } from '../services/routing.js'
import './Sidebar.css'

export default function Sidebar({ onPlan, loading, tripPlan, error, selectedStopIdx, onSelectStop }) {
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [charge, setCharge] = useState(80)

  const handleSubmit = (e) => {
    e.preventDefault()
    if (start.trim() && end.trim()) onPlan(start.trim(), end.trim(), charge)
  }

  const rangeKm = chargeToRange(charge)

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="logo">
          <span className="logo-icon">⚡</span>
          <div>
            <div className="logo-title">Buzz Trip</div>
            <div className="logo-sub">EV Road Trip Planner</div>
          </div>
        </div>
        <div className="vehicle-badge">ID. Buzz</div>
      </div>

      <form className="search-form" onSubmit={handleSubmit}>
        <div className="input-group">
          <div className="input-dot dot-start" />
          <input
            type="text"
            placeholder="Start — city or address"
            value={start}
            onChange={(e) => setStart(e.target.value)}
            className="location-input"
          />
        </div>
        <div className="input-line" />
        <div className="input-group">
          <div className="input-dot dot-end" />
          <input
            type="text"
            placeholder="Destination — city or address"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
            className="location-input"
          />
        </div>

        <div className="charge-input">
          <div className="charge-header">
            <span className="charge-label">Current charge</span>
            <span className="charge-value">{charge}%</span>
          </div>
          <div className="charge-slider-row">
            <div className="battery-icon" data-level={charge <= 20 ? 'low' : charge <= 50 ? 'mid' : 'high'}>
              <div className="battery-body">
                <div className="battery-level" style={{ width: `${charge}%` }} />
              </div>
              <div className="battery-tip" />
            </div>
            <input
              type="range"
              min="5"
              max="100"
              step="5"
              value={charge}
              onChange={(e) => setCharge(Number(e.target.value))}
              className="charge-range"
            />
          </div>
          <div className="charge-range-label">~{rangeKm} km drivable</div>
        </div>

        <button type="submit" className="plan-btn" disabled={loading || !start || !end}>
          {loading ? (
            <><span className="spinner" /> Planning route…</>
          ) : (
            'Plan Trip'
          )}
        </button>
      </form>

      {error && <div className="error-msg">{error}</div>}

      {tripPlan && (
        <div className="trip-plan">
          <div className="trip-summary">
            <div className="summary-item">
              <span className="summary-label">Distance</span>
              <span className="summary-value">{tripPlan.distanceKm.toFixed(0)} km</span>
            </div>
            <div className="summary-item">
              <span className="summary-label">Duration</span>
              <span className="summary-value">{formatDuration(tripPlan.durationMin)}</span>
            </div>
            <div className="summary-item">
              <span className="summary-label">Charge stops</span>
              <span className="summary-value">{tripPlan.stops.filter(s => s.type === 'charge').length}</span>
            </div>
            <div className="summary-item">
              <span className="summary-label">道の駅 / SA</span>
              <span className="summary-value">{tripPlan.stops.filter(s => s.type === 'road_station').length}</span>
            </div>
          </div>

          <div className="arrival-battery" data-level={tripPlan.batteryAtDest <= 20 ? 'low' : tripPlan.batteryAtDest <= 50 ? 'mid' : 'high'}>
            <div className="arrival-icon">🏁</div>
            <div className="arrival-info">
              <div className="arrival-label">Arrive at destination with</div>
              <div className="arrival-percent">{tripPlan.batteryAtDest}%</div>
            </div>
            <div className="arrival-bar-wrap">
              <div className="arrival-bar">
                <div className="arrival-bar-fill" style={{ width: `${Math.max(0, tripPlan.batteryAtDest)}%` }} />
              </div>
              <div className="arrival-range">~{chargeToRange(Math.max(0, tripPlan.batteryAtDest))} km left</div>
            </div>
          </div>

          <div className="stops-list">
            {tripPlan.stops.map((stop, i) => (
              <StopCard key={i} stop={stop} index={i} total={tripPlan.stops.length} selected={selectedStopIdx === i} onSelect={() => onSelectStop(i)} />
            ))}
          </div>
        </div>
      )}

      {!tripPlan && !loading && (
        <div className="empty-state">
          <div className="empty-icon">🚐</div>
          <p>Enter your start and destination to plan your EV camping adventure.</p>
          <div className="range-info">
            <span>ID. Buzz Pro range</span>
            <strong>~460 km</strong>
          </div>
        </div>
      )}
    </aside>
  )
}

function isValidUrl(url) {
  if (!url) return false
  return /^https?:\/\//.test(url)
}

function StopCard({ stop, index, total, selected, onSelect }) {
  if (stop.type === 'start' || stop.type === 'end') {
    return (
      <div className={`stop-card stop-waypoint ${stop.type === 'end' ? 'stop-end' : 'stop-start'} ${selected ? 'selected' : ''}`} onClick={onSelect}>
        <div className="stop-icon">{stop.type === 'start' ? '🏠' : '🏁'}</div>
        <div className="stop-info">
          <div className="stop-name">{stop.name}</div>
          <div className="stop-meta">
            {stop.type === 'start' ? 'Start' : 'Destination'}
            {' · '}{stop.battery}% battery
          </div>
        </div>
      </div>
    )
  }

  if (stop.type === 'charge') {
    return (
      <div className={`stop-card stop-charge ${selected ? 'selected' : ''}`} onClick={onSelect}>
        <div className="stop-icon">⚡</div>
        <div className="stop-info">
          <div className="stop-name">{stop.charger?.name || 'Charging Stop'}</div>
          <div className="stop-meta">
            {stop.charger?.maxKw ? `${stop.charger.maxKw} kW · ` : ''}
            {stop.charger?.network || 'CCS2'}
          </div>
          {stop.charger?.address && (
            <div className="stop-address">{stop.charger.address}</div>
          )}
          <div className="battery-bar">
            <div className="battery-label">
              <span>Arrive {stop.batteryArrival}%</span>
              <span>Depart {stop.batteryDepart}%</span>
            </div>
            <div className="battery-track">
              <div className="battery-fill arrive" style={{ width: `${stop.batteryArrival}%` }} />
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (stop.type === 'camp') {
    return (
      <div className={`stop-card stop-camp ${selected ? 'selected' : ''}`} onClick={onSelect}>
        <div className="stop-icon">⛺</div>
        <div className="stop-info">
          <div className="stop-name">{stop.site?.name || 'Campsite'}</div>
          <div className="stop-meta">
            {stop.site?.type === 'caravan_site' ? 'Caravan / Van Site' : 'Campsite'}
            {stop.site?.electric ? ' · EV hookup' : ''}
          </div>
          {isValidUrl(stop.site?.website) && (
            <a className="stop-link" href={stop.site.website} target="_blank" rel="noopener" onClick={(e) => e.stopPropagation()}>
              Visit website
            </a>
          )}
        </div>
      </div>
    )
  }

  if (stop.type === 'road_station') {
    const s = stop.station
    const isMichi = s?.subtype === 'michinoeki'
    const ev = s?.evCharger
    const chargerTypes = ev ? [
      ev.chademo && 'CHAdeMO',
      ev.ccs && 'CCS2',
      ev.type2 && 'Type 2',
    ].filter(Boolean) : []
    return (
      <div className={`stop-card stop-road ${ev ? 'has-ev' : ''} ${selected ? 'selected' : ''}`} onClick={onSelect}>
        <div className="stop-icon">{isMichi ? '🏪' : '🛣️'}</div>
        <div className="stop-info">
          <div className="stop-name">{s?.name || (isMichi ? '道の駅' : 'Service Area')}</div>
          <div className="stop-meta">
            {isMichi ? '道の駅 · Overnight OK' : 'Highway SA/PA'}
            {s?.operator ? ` · ${s.operator}` : ''}
          </div>
          {s?.address && (
            <div className="stop-address">{s.address}</div>
          )}
          {ev && (
            <div className="ev-tags">
              <span className="ev-tag quick">{ev.quick ? '⚡ Quick Charge' : '🔌 EV Charging'}</span>
              {chargerTypes.map((t) => (
                <span key={t} className="ev-tag type">{t}</span>
              ))}
            </div>
          )}
          {s?.openingHours && (
            <div className="stop-address">{s.openingHours}</div>
          )}
          {isValidUrl(s?.website) && (
            <a className="stop-link" href={s.website} target="_blank" rel="noopener" onClick={(e) => e.stopPropagation()}>
              Visit website
            </a>
          )}
        </div>
      </div>
    )
  }

  return null
}

function formatDuration(minutes) {
  const h = Math.floor(minutes / 60)
  const m = Math.round(minutes % 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}
