import React, {useEffect} from 'react';
import {BrowserRouter, Routes, Route} from 'react-router-dom';
import {Navbar} from './components/layout/Navbar';
import {Footer} from './components/layout/Footer';
import {ScrollToTop} from './components/layout/ScrollToTop';
import {IntroLoader} from './components/effects/IntroLoader';
import {PageTransition} from './components/effects/PageTransition';
import {CustomCursor} from './components/effects/CustomCursor';
import {StatusPill} from './components/layout/StatusPill';
import {ScrollProgress} from './components/effects/ScrollProgress';
import {FilmGrain} from './components/effects/FilmGrain';
import {PointerSpotlight} from './components/effects/PointerSpotlight';
import {Toaster} from './components/ui/Toaster';
import {useUiSounds} from './hooks/useUiSounds';
import {useAuthStore} from './stores/useAuthStore';
import {HomePage} from './pages/HomePage';
import {MenuPage} from './pages/MenuPage';
import {EventsPage} from './pages/EventsPage';
import {GalleryPage} from './pages/GalleryPage';
import {AboutPage} from './pages/AboutPage';
import {LocationPage} from './pages/LocationPage';
import {ReservationsPage} from './pages/ReservationsPage';
import {VipPage} from './pages/VipPage';
import {CareersPage} from './pages/CareersPage';
import {StaffLoginPage} from './pages/StaffLoginPage';
import {ClubPage} from './pages/ClubPage';
import {DjPage} from './pages/DjPage';
import {DashboardPage} from './pages/staff/DashboardPage';
import {ProfilePage} from './pages/staff/ProfilePage';
import {ShiftPage} from './pages/staff/ShiftPage';
import {RegisterPage} from './pages/staff/RegisterPage';
import {InventoryPage} from './pages/staff/InventoryPage';
import {SalesPage} from './pages/staff/SalesPage';
import {UsersPage} from './pages/staff/UsersPage';
import {AuditPage} from './pages/staff/AuditPage';
import {ProductsPage} from './pages/staff/ProductsPage';
import {ReportsPage} from './pages/staff/ReportsPage';
import {DocumentsPage} from './pages/staff/DocumentsPage';
import {StaffReservationsPage} from './pages/staff/ReservationsPage';
import {ApplicationsPage} from './pages/staff/ApplicationsPage';
import {OrdersPage} from './pages/staff/OrdersPage';
import {RequireRole} from './components/auth/RequireRole';
import {NotFoundPage} from './pages/NotFoundPage';

export const App: React.FC = () => {
  useUiSounds();

  // Restore an existing staff session once, so manager tools appear on reload.
  const restore = useAuthStore((state) => state.restore);
  useEffect(() => {
    restore();
  }, [restore]);

  return (
    <BrowserRouter>
      <ScrollToTop/>
      {/* Outside the page chrome: `main` creates a stacking context, which would
          trap the full-screen entrance underneath the fixed navbar. */}
      <IntroLoader/>
      <PageTransition/>
      <CustomCursor/>
      <StatusPill/>
      <ScrollProgress/>
      <FilmGrain/>
      <PointerSpotlight/>
      <Toaster/>
      <div className="flex min-h-screen flex-col">
        <Navbar/>
        <div className="flex-1">
          <Routes>
            <Route path="/" element={<HomePage/>}/>
            <Route path="/menu" element={<MenuPage/>}/>
            <Route path="/events" element={<EventsPage/>}/>
            <Route path="/gallery" element={<GalleryPage/>}/>
            <Route path="/about" element={<AboutPage/>}/>
            <Route path="/location" element={<LocationPage/>}/>
            <Route path="/reservations" element={<ReservationsPage/>}/>
            <Route path="/vip" element={<VipPage/>}/>
            <Route path="/careers" element={<CareersPage/>}/>

            <Route path="/club" element={<ClubPage/>}/>
            <Route path="/dj" element={<DjPage/>}/>
            <Route path="/staff-login" element={<StaffLoginPage/>}/>
            <Route
              path="/staff"
              element={
                <RequireRole>
                  <DashboardPage/>
                </RequireRole>
              }
            />
            <Route
              path="/staff/profile"
              element={
                <RequireRole>
                  <ProfilePage/>
                </RequireRole>
              }
            />
            <Route
              path="/staff/shift"
              element={
                <RequireRole>
                  <ShiftPage/>
                </RequireRole>
              }
            />
            <Route
              path="/staff/register"
              element={
                <RequireRole>
                  <RegisterPage/>
                </RequireRole>
              }
            />
            <Route
              path="/staff/inventory"
              element={
                <RequireRole need="manager">
                  <InventoryPage/>
                </RequireRole>
              }
            />
            <Route
              path="/staff/sales"
              element={
                <RequireRole>
                  <SalesPage/>
                </RequireRole>
              }
            />
            <Route
              path="/staff/users"
              element={
                <RequireRole need="owner">
                  <UsersPage/>
                </RequireRole>
              }
            />
            <Route
              path="/staff/audit"
              element={
                <RequireRole need="owner">
                  <AuditPage/>
                </RequireRole>
              }
            />
            <Route
              path="/staff/products"
              element={
                <RequireRole need="manager">
                  <ProductsPage/>
                </RequireRole>
              }
            />
            <Route
              path="/staff/reports"
              element={
                <RequireRole need="owner">
                  <ReportsPage/>
                </RequireRole>
              }
            />
            <Route
              path="/staff/reservations"
              element={
                <RequireRole>
                  <StaffReservationsPage/>
                </RequireRole>
              }
            />
            <Route
              path="/staff/orders"
              element={
                <RequireRole>
                  <OrdersPage/>
                </RequireRole>
              }
            />
            <Route
              path="/staff/applications"
              element={
                <RequireRole need="manager">
                  <ApplicationsPage/>
                </RequireRole>
              }
            />
            <Route
              path="/staff/documents"
              element={
                <RequireRole need="manager">
                  <DocumentsPage/>
                </RequireRole>
              }
            />

            <Route path="*" element={<NotFoundPage/>}/>
          </Routes>
        </div>
        <Footer/>
      </div>
    </BrowserRouter>
  );
};
