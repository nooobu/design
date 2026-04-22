import { createContext, useContext, useState, useCallback } from 'react'

const TripStateContext = createContext(null)

export function TripStateProvider({ children }) {
  const [tripPlan, setTripPlan] = useState(null)
  const [selectedStopIdx, setSelectedStopIdx] = useState(null)

  const selectStop = useCallback((idx) => {
    setSelectedStopIdx((prev) => (prev === idx ? null : idx))
  }, [])

  return (
    <TripStateContext.Provider value={{ tripPlan, setTripPlan, selectedStopIdx, selectStop }}>
      {children}
    </TripStateContext.Provider>
  )
}

export function useTripState() {
  const ctx = useContext(TripStateContext)
  if (!ctx) throw new Error('useTripState must be inside TripStateProvider')
  return ctx
}
