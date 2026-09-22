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
import {DialogHost} from './components/ui/DialogHost';
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
import {StaffEventsPage} from './pages/staff/EventsPage';
import {ShowcasePage} from './pages/staff/ShowcasePage';
import {RequireRole} from './components/auth/RequireRole';
import {NotFoundPage} from './pages/NotFoundPage';
import type {Role} from './stores/useAuthStore';

/** Console routes and the lowest rank that may open them. */
const CONSOLE_ROUTES: {path: string; need?: Role; element: React.ReactNode}[] = [
  {path: '/staff', element: <DashboardPage/>},
  {path: '/staff/profile', element: <ProfilePage/>},
  {path: '/staff/shift', element: <ShiftPage/>},
  {path: '/staff/register', element: <RegisterPage/>},
  {path: '/staff/sales', element: <SalesPage/>},
  {path: '/staff/reservations', element: <StaffReservationsPage/>},
  {path: '/staff/orders', element: <OrdersPage/>},
  {path: '/staff/inventory', need: 'manager', element: <InventoryPage/>},
  {path: '/staff/products', need: 'manager', element: <ProductsPage/>},
  {path: '/staff/applications', need: 'manager', element: <ApplicationsPage/>},
  {path: '/staff/documents', need: 'manager', element: <DocumentsPage/>},
  {path: '/staff/events', need: 'owner', element: <StaffEventsPage/>},
  {path: '/staff/showcase', need: 'owner', element: <ShowcasePage/>},
  {path: '/staff/reports', need: 'owner', element: <ReportsPage/>},
  {path: '/staff/users', need: 'owner', element: <UsersPage/>},
  {path: '/staff/audit', need: 'owner', element: <AuditPage/>}
];

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
      <DialogHost/>
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

            {CONSOLE_ROUTES.map((route) => (
              <Route
                key={route.path}
                path={route.path}
                element={<RequireRole need={route.need}>{route.element}</RequireRole>}
              />
            ))}

            <Route path="*" element={<NotFoundPage/>}/>
          </Routes>
        </div>
        <Footer/>
      </div>
    </BrowserRouter>
  );
};
