import proj4 from 'proj4';
import { register } from 'ol/proj/proj4.js';
import { get as getProjection } from 'ol/proj.js';
import type { Category } from '../../types';

/**
 * Equal Earth Projection Definition (EPSG:8857)
 * Authoritative PROJ.4 parameter string for Equal Earth Greenwich.
 * Keeps projection configuration isolated, verifiable, and prevents Web Mercator fallback.
 */
export const EQUAL_EARTH_CODE = 'EPSG:8857';
export const EQUAL_EARTH_PROJ4_DEF = '+proj=eqearth +lon_0=0 +x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs';
export const EQUAL_EARTH_EXTENT: [number, number, number, number] = [
  -17243959.06,
  -8392928.0,
  17243959.06,
  8392928.0,
];

/**
 * Register the Equal Earth projection with proj4 and OpenLayers.
 */
export function registerEqualEarthProjection() {
  if (!proj4.defs(EQUAL_EARTH_CODE)) {
    proj4.defs(EQUAL_EARTH_CODE, EQUAL_EARTH_PROJ4_DEF);
  }
  register(proj4);
  const proj = getProjection(EQUAL_EARTH_CODE);
  if (proj) {
    proj.setExtent(EQUAL_EARTH_EXTENT);
    proj.setWorldExtent([-180, -90, 180, 90]);
  }
  return proj;
}

/**
 * Public domain dataset path for technical prototyping of the OpenLayers Equal Earth map view.
 * Bundled locally to ensure 100% reliable offline/test execution without external network dependence.
 */
export const GEOGRAPHIC_DATA_SOURCE = {
  name: 'Natural Earth 110m Admin 0 Countries',
  path: '/data/ne_110m_admin_0_countries.geojson',
  format: 'GeoJSON (FeatureCollection of MultiPolygon / Polygon)',
  mode: 'Bundled local asset with HTTP fetch and error handling',
  license: 'Public Domain (Natural Earth / CC0)',
  status: 'Technical Prototype Only — NOT official or authoritative boundaries',
};

export interface MapEventMarker {
  id: string;
  titleAr: string;
  titleEn: string;
  locationAr: string;
  locationEn: string;
  category: Category;
  date: string;
  summaryAr: string;
  summaryEn: string;
  coordinates: [number, number]; // [longitude, latitude] in EPSG:4326
  scope: 'Sudan' | 'Africa' | 'Global';
  dataType: 'real-geo-demo' | 'real-geo-content-linked';
  relatedContentId?: string; // Prototype linkage indicator only
}

/**
 * Verified markers with authentic geographic coordinates in EPSG:4326.
 * Explicitly categorized as demo or content-linked to prevent misleading users.
 */
export const PROTOTYPE_MAP_MARKERS: MapEventMarker[] = [
  {
    id: 'marker-khartoum-01',
    titleAr: 'رصد جودة الهواء ونفايات المناطق الحضرية',
    titleEn: 'Urban Air Quality & Waste Monitoring',
    locationAr: 'الخرطوم — ملتقى النيلين',
    locationEn: 'Khartoum — Confluence of the Two Niles',
    category: 'Pollution',
    date: '2026-03-04',
    summaryAr: 'مبادرات مجتمعية لتدوير النفايات البلاستيكية ومكافحة الانبعاثات الحضرية على ضفاف النيل.',
    summaryEn: 'Community initiatives for plastic recycling and urban emissions reduction along the Nile.',
    coordinates: [32.5599, 15.5007],
    scope: 'Sudan',
    dataType: 'real-geo-demo',
  },
  {
    id: 'marker-blue-nile-02',
    titleAr: 'انخفاض درجات الحرارة ونشاط الرياح الموسمية',
    titleEn: 'Temperature Drop & Seasonal Winds',
    locationAr: 'ولاية النيل الأزرق — الدمازين',
    locationEn: 'Blue Nile State — Ad-Damazin',
    category: 'Climate',
    date: '2026-03-02',
    summaryAr: 'رصد تغيرات درجات الحرارة وموجات الرطوبة الفصلية لحماية المراعي وحزام الغابات.',
    summaryEn: 'Tracking temperature variances and seasonal humidity to preserve pastures and forest belts.',
    coordinates: [34.3644, 11.7708],
    scope: 'Sudan',
    dataType: 'real-geo-content-linked',
    relatedContentId: 'news-climate-01',
  },
  {
    id: 'marker-gash-03',
    titleAr: 'فيضان نهر القاش وإدارة الطمي الموسمي',
    titleEn: 'River Gash Spate & Silt Management',
    locationAr: 'ولاية كسلا — دلتا القاش',
    locationEn: 'Kassala State — Gash Delta',
    category: 'Water',
    date: '2026-03-03',
    summaryAr: 'توثيق تقنيات الري الفيضي التقليدي ومواجهة الانجرافات النهرية في شرق السودان.',
    summaryEn: 'Documenting traditional spate irrigation techniques and riverbank erosion in Eastern Sudan.',
    coordinates: [36.4000, 15.4500],
    scope: 'Sudan',
    dataType: 'real-geo-content-linked',
    relatedContentId: 'vid-gash-flood-02',
  },
  {
    id: 'marker-darfur-04',
    titleAr: 'مكافحة التصحر وزحف الرمال في دارفور',
    titleEn: 'Combatting Desertification in Darfur',
    locationAr: 'شمال دارفور — الفاشر',
    locationEn: 'North Darfur — El Fasher',
    category: 'Agriculture',
    date: '2026-02-28',
    summaryAr: 'تحقيق استقصائي حول خطوط مصدات الرياح وتثبيت الكثبان الرملية في الحزام شبه الجاف.',
    summaryEn: 'Investigative coverage on windbreak lines and sand dune stabilization in the semi-arid belt.',
    coordinates: [25.3547, 13.6279],
    scope: 'Sudan',
    dataType: 'real-geo-content-linked',
    relatedContentId: 'report-desertification-01',
  },
  {
    id: 'marker-red-sea-05',
    titleAr: 'حماية الشعاب المرجانية في خليج دنقناب وسنغنيب',
    titleEn: 'Coral Reef Conservation in Sanganeb & Dungonab',
    locationAr: 'ولاية البحر الأحمر — بورتسودان',
    locationEn: 'Red Sea State — Port Sudan',
    category: 'Biodiversity',
    date: '2026-02-20',
    summaryAr: 'برامج حماية الأنظمة البيئية البحرية والحد من ارتفاع حرارة المياه الساحلية.',
    summaryEn: 'Marine ecosystem conservation programs mitigating coastal warming impacts.',
    coordinates: [37.2167, 19.6167],
    scope: 'Sudan',
    dataType: 'real-geo-demo',
  },
  {
    id: 'marker-sahel-06',
    titleAr: 'مبادرة الجدار الأخضر الإفريقي العظيم',
    titleEn: 'Great Green Wall of Africa Initiative',
    locationAr: 'إقليم الساحل الإفريقي',
    locationEn: 'African Sahel Region',
    category: 'Biodiversity',
    date: '2026-01-15',
    summaryAr: 'شراكة إقليمية عابرة للحدود لمكافحة تدهور الأراضي واستعادة الغطاء النباتي.',
    summaryEn: 'Transboundary regional partnership combating land degradation and restoring vegetation.',
    coordinates: [15.0000, 14.0000],
    scope: 'Africa',
    dataType: 'real-geo-demo',
  },
  {
    id: 'marker-cop-07',
    titleAr: 'مؤتمر أطراف المناخ — اتفاقيات التكيف والتمويل',
    titleEn: 'Global Climate COP — Adaptation & Finance',
    locationAr: 'المجتمع الدولي — رصد عالمي',
    locationEn: 'International Arena — Global Tracking',
    category: 'EnvironmentalPolicy',
    date: '2026-02-10',
    summaryAr: 'متابعة التزامات تمويل الخسائر والأضرار ودعم خطط التكيف الوطنية للدول الأكثر هشاشة.',
    summaryEn: 'Tracking loss and damage financing and national adaptation commitments for vulnerable states.',
    coordinates: [6.1432, 46.2044],
    scope: 'Global',
    dataType: 'real-geo-demo',
  },
];
