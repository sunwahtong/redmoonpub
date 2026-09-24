import React, {lazy, Suspense, useEffect} from 'react';
import {BrowserRouter, Routes, Route} from 'react-router-dom';
import {Navbar} from './components/layout/Navbar';
import {Footer} from './components/layout/Footer';
import {ScrollToTop} from './components/layout/ScrollToTop';
import {IntroLoader} from './components/effects/IntroLoader';
import {PageTransition} from './components/effects/PageTransition';
import {CustomCursor} from './components/effects/CustomCursor';
import {StatusPill} from './components/layout/StatusPill';
import {LivePopup} from './components/layout/LivePopup';
import {ScrollProgress} from './components/effects/ScrollProgress';
import {FilmGrain} from './components/effects/FilmGrain';
import {PointerSpotlight} from './components/effects/PointerSpotlight';
import {Toaster} from './components/ui/Toaster';
import {DialogHost} from './components/ui/DialogHost';
import {TourHost} from './components/staff/Tour';
import {ShiftReportHost} from './components/staff/ShiftReport';
import {ErrorBoundary} from './components/ui/ErrorBoundary';
import {useUiSounds} from './hooks/useUiSounds';
import {useAuthStore} from './stores/useAuthStore';
import {HomePage} from './pages/HomePage';
import {MenuPage} from './pages/MenuPage';
import {EventsPage} from './pages/EventsPage';
import {GalleryPage} from './pages/GalleryPage';
import {AboutPage} from './pages/AboutPage';
import {ReservationsPage} from './pages/ReservationsPage';
import {VipPage} from './pages/VipPage';
import {CareersPage} from './pages/CareersPage';
import {StaffLoginPage} from './pages/StaffLoginPage';
import {ClubPage} from './pages/ClubPage';
import {NewsPage} from './pages/NewsPage';
import {RequireRole} from './components/auth/RequireRole';
import {NotFoundPage} from './pages/NotFoundPage';
import type {Role} from './stores/useAuthStore';

/*
 * The public pages ship in the main bundle: they are what a visitor opens.
 * The map (Leaflet), the booth and the whole console load on first use, so
 * nobody downloads the register to read the drink list.
 */
const load = <T extends Record<string, React.ComponentType<any>>>(loader: () => Promise<T>, name: keyof T) =>
  lazy(() => loader().then((module) => ({default: module[name] as React.ComponentType<any>})));

const LocationPage = load(() => import('./pages/LocationPage'), 'LocationPage');
const DjPage = load(() => import('./pages/DjPage'), 'DjPage');
const DashboardPage = load(() => import('./pages/staff/DashboardPage'), 'DashboardPage');
const ProfilePage = load(() => import('./pages/staff/ProfilePage'), 'ProfilePage');
const ShiftPage = load(() => import('./pages/staff/ShiftPage'), 'ShiftPage');
const RegisterPage = load(() => import('./pages/staff/RegisterPage'), 'RegisterPage');
const InventoryPage = load(() => import('./pages/staff/InventoryPage'), 'InventoryPage');
const SalesPage = load(() => import('./pages/staff/SalesPage'), 'SalesPage');
const UsersPage = load(() => import('./pages/staff/UsersPage'), 'UsersPage');
const AuditPage = load(() => import('./pages/staff/AuditPage'), 'AuditPage');
const ProductsPage = load(() => import('./pages/staff/ProductsPage'), 'ProductsPage');
const ReportsPage = load(() => import('./pages/staff/ReportsPage'), 'ReportsPage');
const DocumentsPage = load(() => import('./pages/staff/DocumentsPage'), 'DocumentsPage');
const StaffReservationsPage = load(() => import('./pages/staff/ReservationsPage'), 'StaffReservationsPage');
const ApplicationsPage = load(() => import('./pages/staff/ApplicationsPage'), 'ApplicationsPage');
const OrdersPage = load(() => import('./pages/staff/OrdersPage'), 'OrdersPage');
const StaffEventsPage = load(() => import('./pages/staff/EventsPage'), 'StaffEventsPage');
const ShowcasePage = load(() => import('./pages/staff/ShowcasePage'), 'ShowcasePage');
const StaffGalleryPage = load(() => import('./pages/staff/GalleryPage'), 'StaffGalleryPage');
const PostsPage = load(() => import('./pages/staff/PostsPage'), 'PostsPage');
const MembersPage = load(() => import('./pages/staff/MembersPage'), 'MembersPage');

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
  {path: '/staff/members', need: 'manager', element: <MembersPage/>},
  {path: '/staff/documents', need: 'manager', element: <DocumentsPage/>},
  {path: '/staff/events', need: 'owner', element: <StaffEventsPage/>},
  {path: '/staff/showcase', need: 'owner', element: <ShowcasePage/>},
  {path: '/staff/gallery', need: 'owner', element: <StaffGalleryPage/>},
  {path: '/staff/posts', need: 'owner', element: <PostsPage/>},
  {path: '/staff/reports', need: 'owner', element: <ReportsPage/>},
  {path: '/staff/users', need: 'owner', element: <UsersPage/>},
  {path: '/staff/audit', need: 'owner', element: <AuditPage/>}
];

const PageLoading: React.FC = () => (
  <main className="flex min-h-[70vh] items-center justify-center pt-[68px]">
    <span className="rm-loading-line" aria-hidden="true"/>
    <span className="sr-only">Betöltés</span>
  </main>
);

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
      <LivePopup/>
      <ScrollProgress/>
      <FilmGrain/>
      <PointerSpotlight/>
      <Toaster/>
      <DialogHost/>
      <TourHost/>
      <ShiftReportHost/>
      <div className="flex min-h-screen flex-col">
        <Navbar/>
        <div className="flex-1">
          <ErrorBoundary>
            <Suspense fallback={<PageLoading/>}>
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
                <Route path="/hirek" element={<NewsPage/>}/>

                <Route path="/club" element={<ClubPage/>}/>
                <Route path="/dj" element={<DjPage/>}/>
                <Route path="/staff-login" element={<StaffLoginPage/>}/>

                {CONSOLE_ROUTES.map((route) => (
                  <Route key={route.path} path={route.path} element={<RequireRole need={route.need}>{route.element}</RequireRole>}/>
                ))}

                <Route path="*" element={<NotFoundPage/>}/>
              </Routes>
            </Suspense>
          </ErrorBoundary>
        </div>
        <Footer/>
      </div>
    </BrowserRouter>
  );
};
