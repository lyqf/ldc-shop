import { getActiveProductCategories, getCategories, getProductRatings, getVisitorCount, getUserPendingOrders, searchActiveProducts } from "@/lib/db/queries";
import { getActiveAnnouncement } from "@/actions/settings";
import { auth } from "@/lib/auth";
import { HomeContent } from "@/components/home-content";
import { unstable_cache } from "next/cache";

const CACHE_TTL_SECONDS = 30;
const TAG_PRODUCTS = "home:products";
const TAG_RATINGS = "home:ratings";
const TAG_ANNOUNCEMENT = "home:announcement";
const TAG_VISITORS = "home:visitors";
const TAG_CATEGORIES = "home:categories";
const TAG_PRODUCT_CATEGORIES = "home:product-categories";

const PAGE_SIZE = 24;

const getCachedAnnouncement = unstable_cache(
  async () => getActiveAnnouncement(),
  ["active-announcement"],
  { revalidate: CACHE_TTL_SECONDS, tags: [TAG_ANNOUNCEMENT] }
);

const getCachedVisitorCount = unstable_cache(
  async () => getVisitorCount(),
  ["visitor-count"],
  { revalidate: CACHE_TTL_SECONDS, tags: [TAG_VISITORS] }
);

const getCachedCategories = unstable_cache(
  async () => getCategories(),
  ["categories"],
  { revalidate: CACHE_TTL_SECONDS, tags: [TAG_CATEGORIES] }
);

const getCachedProductCategories = unstable_cache(
  async () => getActiveProductCategories(),
  ["active-product-categories"],
  { revalidate: CACHE_TTL_SECONDS, tags: [TAG_PRODUCT_CATEGORIES, TAG_PRODUCTS] }
);

function stripMarkdown(input: string): string {
  return input
    .replace(/!\[.*?\]\(.*?\)/g, '')
    .replace(/\[(.*?)\]\(.*?\)/g, '$1')
    .replace(/[`*_>#+-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export default async function Home({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}) {
  const resolved = searchParams ? await searchParams : {}
  const q = (typeof resolved.q === 'string' ? resolved.q : '').trim();
  const categoryParam = (typeof resolved.category === 'string' ? resolved.category : '').trim();
  const category = categoryParam && categoryParam !== 'all' ? categoryParam : '';
  const sort = (typeof resolved.sort === 'string' ? resolved.sort : 'default').trim();
  const page = Math.max(1, Number.parseInt(typeof resolved.page === 'string' ? resolved.page : '1', 10) || 1);

  // Run all independent queries in parallel for better performance
  const [session, productsResult, announcement, visitorCount, categoryConfig, productCategories] = await Promise.all([
    auth(),
    unstable_cache(
      async () => searchActiveProducts({ q, category, sort, page, pageSize: PAGE_SIZE }),
      ["search-active-products", q, category || 'all', sort, String(page), String(PAGE_SIZE)],
      { revalidate: CACHE_TTL_SECONDS, tags: [TAG_PRODUCTS] }
    )().catch(() => ({ items: [], total: 0, page, pageSize: PAGE_SIZE })),
    getCachedAnnouncement().catch(() => null),
    getCachedVisitorCount().catch(() => 0),
    getCachedCategories().catch(() => []),
    getCachedProductCategories().catch(() => [])
  ]);

  const products = productsResult.items || [];
  const total = productsResult.total || 0;

  const productIds = products.map((p: any) => p.id).filter(Boolean);
  const sortedIds = [...productIds].sort();
  let ratingsMap = new Map<string, { average: number; count: number }>();
  try {
    ratingsMap = await unstable_cache(
      async () => getProductRatings(sortedIds),
      ["product-ratings", ...sortedIds],
      { revalidate: CACHE_TTL_SECONDS, tags: [TAG_RATINGS] }
    )();
  } catch {
    // Reviews table might not exist yet
  }

  const productsWithRatings = products.map((p: any) => {
    const rating = ratingsMap.get(p.id) || { average: 0, count: 0 };
    return {
      ...p,
      stockCount: p.stock + (p.locked || 0),
      soldCount: p.sold || 0,
      descriptionPlain: stripMarkdown(p.description || ''),
      rating: rating.average,
      reviewCount: rating.count
    };
  });

  // Check for pending orders (depends on session)
  let pendingOrders: any[] = [];
  if (session?.user?.id) {
    try {
      pendingOrders = await getUserPendingOrders(session.user.id);
    } catch {
      // Ignore errors fetching pending orders
    }
  }

  const categoryNames = categoryConfig
    .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0))
    .map((c) => c.name);
  const extraCategories = productCategories.filter((c) => !categoryNames.includes(c)).sort();
  const categories = [...categoryNames, ...extraCategories];

  return <HomeContent
    products={productsWithRatings}
    announcement={announcement}
    visitorCount={visitorCount}
    categories={categories}
    categoryConfig={categoryConfig}
    pendingOrders={pendingOrders}
    filters={{ q, category: category || null, sort }}
    pagination={{ page, pageSize: PAGE_SIZE, total }}
  />;
}
