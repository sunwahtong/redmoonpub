import {can, roleAtLeast, type AuthUser} from '../stores/useAuthStore';

/**
 * The guided tour of the console.
 *
 * Four modules, one per kind of work: everyone gets the staff module, the
 * booth module goes to whoever may open the booth, managers get the manager
 * module, the owner gets all four. Each step names a page and a `data-tour`
 * target on it; the host navigates there, lights the target up and explains
 * it in a few lines. What an account has seen is kept on the account
 * (`tours`), so a promotion or a new job brings the missing module up on the
 * next visit.
 */

export type TourModule = 'staff' | 'dj' | 'manager' | 'owner';

export interface TourStep {
  /** The page the step lives on. The host navigates there first. */
  path: string;
  /** A `data-tour` value on that page. `page` falls back to the page heading. Without one the card sits centred. */
  target?: string;
  title: string;
  text: string;
}

export interface TourModuleDef {
  id: TourModule;
  label: string;
  blurb: string;
  steps: TourStep[];
}

export const TOUR_MODULES: Record<TourModule, TourModuleDef> = {
  staff: {
    id: 'staff',
    label: 'A KONZOL',
    blurb: 'Menü, műszak, kassza, foglalások, beszerzés, profil.',
    steps: [
      {
        path: '/staff',
        target: 'nav',
        title: 'Ez a konzol menüje.',
        text: 'Felül az ÁTTEKINTÉS és a négy terület: MŰSZAK, VENDÉG, KÉSZLET, HÁZ. Az alsó sor mindig annak a területnek az eszközeit mutatja, amelyikben épp vagy — vagy amelyikre koppintottál. Csak azt látod, amihez jogod van.'
      },
      {
        path: '/staff',
        target: 'now',
        title: 'Ami most történik.',
        text: 'Az ajtó, a műszak, a pult és a csapat egy pillantásra. A csempék élők: ha valaki kinyitja a házat vagy a pult adásba megy, itt látod először.'
      },
      {
        path: '/staff',
        target: 'quick',
        title: 'A gyors gombok.',
        text: 'Amit egy este a legtöbbször nyomsz. A pirossal keretezett a következő teendő, a számok pedig azt jelzik, hol vár rád valami: várakozó foglalás, kiírt beszerzés, fogyó készlet.'
      },
      {
        path: '/staff',
        target: 'board',
        title: 'Az üzenőfal.',
        text: 'A ház közleményei a csapatnak: mi lesz ma este, mire figyeljetek. Műszak előtt olvasd át. A managerek írják, a tulajdonos tűzi ki, ami fontos.'
      },
      {
        path: '/staff/shift',
        target: 'page',
        title: 'A műszak.',
        text: 'Minden este itt kezdődik. Nyisd meg a műszakot a kezdő kasszával, add hozzá, ki dolgozik veled, és zárd le a végén a záró kasszával. Nyitott műszak nélkül a kassza nem enged eladni.'
      },
      {
        path: '/staff/register',
        target: 'page',
        title: 'A kassza.',
        text: 'Eladás rögzítése: válaszd ki a tételeket, a fizetési módot, és a nyugta kész. Amit itt ütsz be, az azonnal levonódik a készletből, és este a jelentésben is megjelenik.'
      },
      {
        path: '/staff/reservations',
        target: 'page',
        title: 'A foglalások.',
        text: 'Ma esti asztalok és a beérkező kérések. Igazold vissza, tedd várólistára, ültesd le — vagy írj a vendégnek: ő a saját foglalási oldalán látja a választ.'
      },
      {
        path: '/staff/orders',
        target: 'page',
        title: 'A beszerzés.',
        text: 'Ha valami fogy, itt írod ki. A kiírt tételt bárki bevásárolhatja; a beérkezéskor a raktár magától frissül, és a kiadás a jelentésbe kerül.'
      },
      {
        path: '/staff/profile',
        target: 'profile',
        title: 'A profilod.',
        text: 'Név, becenév, igazolványszám, telefonszám és jelszó. A profilod alján ezt a bemutatót is bármikor újranézheted — részenként, vagy az egészet elölről.'
      }
    ]
  },
  manager: {
    id: 'manager',
    label: 'A MANAGER',
    blurb: 'Ajtó, raktár, termékek, jelentkezők, bizonylatok, a House.',
    steps: [
      {
        path: '/staff',
        target: 'door',
        title: 'Az ajtó a tiéd.',
        text: 'Managerként te nyitod és zárod a házat. Nyitva: a nyilvános oldal MOST NYITVA-t mutat, a foglalások élnek. A műszak zárása az ajtót is bezárja.'
      },
      {
        path: '/staff',
        target: 'board',
        title: 'Te írsz a falra.',
        text: 'Ami a csapatnak szól ma estére, azt ide írd: egy sor is elég. A tulajdonos kitűzheti, ami hosszabb ideig érvényes.'
      },
      {
        path: '/staff/inventory',
        target: 'page',
        title: 'A raktár.',
        text: 'Készlet, minimumok, leltár. Ami a minimum alá esik, az áttekintésen is felvillan — és a beszerzésbe egy koppintással kiírható.'
      },
      {
        path: '/staff/products',
        target: 'page',
        title: 'A termékek.',
        text: 'Az itallap és a kassza tételei egy helyen: név, ár, kategória, kép. Amit itt kikapcsolsz, az sehol nem látszik többé, de az eladások megmaradnak.'
      },
      {
        path: '/staff/applications',
        target: 'page',
        title: 'A jelentkezők.',
        text: 'Aki a CSATLAKOZZ oldalon jelentkezett, itt vár. Behívás, elutasítás, jegyzet — a jelentkező a saját oldalán látja, hol tart.'
      },
      {
        path: '/staff/documents',
        target: 'page',
        title: 'A bizonylatok.',
        text: 'Nyugta, számla, műszakjelentés PDF-ben, a te aláírásoddal. Az első kiadott dokumentum után az aláírásod végleges lesz, ezért érdemes előbb a profilodon beállítani.'
      },
      {
        path: '/staff/members',
        target: 'page',
        title: 'A House.',
        text: 'A ház tagsága: mindenkinek kódja és szintje van, a látogatásait az ajtónál számoljuk. Silver és Gold szintet te adsz, Black és Royal a tulajdonosé. A tag a kódjával foglal, és a foglalása a szintjével érkezik.'
      }
    ]
  },
  dj: {
    id: 'dj',
    label: 'A PULT',
    blurb: 'Adás, bemondás, kérések, chat, szavazás, zenetár.',
    steps: [
      {
        path: '/dj',
        target: 'dj-live',
        title: 'Az adás.',
        text: 'A pult szíve. Ha a GoCast-on sugárzol, az oldal magától élőbe vált; a gombbal kézzel is indíthatod vagy zárhatod. A kézzel indított adás tíz perc rádiócsend után magától lezárul.'
      },
      {
        path: '/dj',
        target: 'dj-announce',
        title: 'A bemondás.',
        text: 'A most szóló szám a stream metaadatából jön magától. Ha a szoftvered nem küld címet, mondd be itt: a setlistre kerül, a klub azonnal látja.'
      },
      {
        path: '/dj',
        target: 'dj-requests',
        title: 'A kérések.',
        text: 'A hallgatók kérései a szavazataikkal. Fogadd el, játszd le, vagy utasítsd el — és ha elég, zárd le a kéréseket egy estére.'
      },
      {
        path: '/dj',
        target: 'dj-chat',
        title: 'A chat és a közlemény.',
        text: 'A klub chatje innen moderálható: törölhetsz, lassíthatod. A közlemény a chat tetejére kerül kitűzve — a következő vendég, a szünet, bármi, ami mindenkinek szól.'
      },
      {
        path: '/dj',
        target: 'dj-poll',
        title: 'A szavazás.',
        text: 'Kérdezd a termet: egy kérdés, pár válasz, pár perc. Az eredmény élőben nő a klub oldalán, és te döntesz, mi legyen belőle.'
      },
      {
        path: '/dj',
        target: 'dj-library',
        title: 'A zenetár.',
        text: 'Saját fájlok a ház hangrendszerére: feltöltés, sor, lejátszás. Akkor kell, ha nem a rádió szól — például egy privát estén.'
      }
    ]
  },
  owner: {
    id: 'owner',
    label: 'A TULAJDONOS',
    blurb: 'Fiókok, kirakat, rendezvények, galéria, hírek, jelentések, napló.',
    steps: [
      {
        path: '/staff/users',
        target: 'page',
        title: 'A fiókok.',
        text: 'Új ember a csapatba: szerep (staff, manager), munkakör (bartender, DJ, biztonság, manager), induló jelszó. Innen állítod vissza a jelszót, és itt adod a manager aláírását is.'
      },
      {
        path: '/staff/showcase',
        target: 'page',
        title: 'A kirakat.',
        text: 'A ház nyilvános arca: adatok, a csapat a Rólunk oldalon, a signature italok — és a főoldal filmje, amit YouTube-ról illesztesz be.'
      },
      {
        path: '/staff/events',
        target: 'page',
        title: 'A rendezvények.',
        text: 'Esték a naptárba: cím, borító, belépő, kiemelés. A vendégek OTT LESZEK-et nyomnak rá, a számot a rendezvényen látod.'
      },
      {
        path: '/staff/gallery',
        target: 'page',
        title: 'A galéria.',
        text: 'Képek a nyilvános galériába. A fal magától rendezi el őket: ahány kép, annyiféle rács.'
      },
      {
        path: '/staff/posts',
        target: 'page',
        title: 'A hírek.',
        text: 'A ház hírei a HÍREK oldalra és a főoldal tetejére. A kitűzött poszt marad felül, amíg le nem veszed.'
      },
      {
        path: '/staff/reports',
        target: 'page',
        title: 'A jelentések.',
        text: 'Bevétel, kiadás, eredmény, top termékek — időszakra bontva. Ugyanaz a szám, ami a bizonylatokban is szerepel.'
      },
      {
        path: '/staff/audit',
        target: 'page',
        title: 'A napló.',
        text: 'Minden fontos művelet nyoma: ki, mikor, mit. Ha valami nem stimmel, itt derül ki.'
      }
    ]
  }
};

/** The order the modules play in when several are due. */
export const TOUR_ORDER: TourModule[] = ['staff', 'manager', 'dj', 'owner'];

/** The modules this account should see, in play order. */
export function requiredModules(user: AuthUser | null | undefined): TourModule[] {
  if (!user) return [];
  return TOUR_ORDER.filter((module) => {
    if (module === 'staff') return true;
    if (module === 'manager') return roleAtLeast(user.role, 'manager');
    if (module === 'dj') return can(user, 'dj');
    return roleAtLeast(user.role, 'owner');
  });
}

/** Required modules the account has neither finished nor skipped. */
export function pendingModules(user: AuthUser | null | undefined): TourModule[] {
  const seen = user?.tours || {};
  return requiredModules(user).filter((module) => !seen[module]);
}
