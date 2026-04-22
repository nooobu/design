import './App.css'
import ChatPanel from './components/ChatPanel.jsx'
import MapView from './components/MapView.jsx'
import { TripStateProvider, useTripState } from './hooks/useTripState.jsx'

function AppInner() {
  const { tripPlan, selectedStopIdx } = useTripState()

  return (
    <div className="app">
      <ChatPanel />
      <MapView tripPlan={tripPlan} selectedStopIdx={selectedStopIdx} />
    </div>
  )
}

export default function App() {
  return (
    <TripStateProvider>
      <AppInner />
    </TripStateProvider>
  )
}
