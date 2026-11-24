import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './auth/AuthProvider'
import { LoginPage } from './auth/LoginPage'
import { useAuth } from './auth/useAuth'
import { TripPage } from './trips/TripPage'
import { TripsPage } from './trips/TripsPage'

function AppRoutes() {
  const { session, loading } = useAuth()
  if (loading) return null
  if (!session) return <LoginPage />
  return (
    <Routes>
      <Route path="/" element={<TripsPage />} />
      <Route path="/trips/:tripId" element={<TripPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </AuthProvider>
  )
}
