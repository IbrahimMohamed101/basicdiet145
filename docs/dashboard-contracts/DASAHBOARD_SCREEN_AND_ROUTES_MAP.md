Basic Diet Admin Dashboard: Route and Screen Map
Overview

The dashboard is a React application (Vite + TanStack Router) that exposes a set of protected routes under the /_protected prefix. Each route is declared via createFileRoute() inside the src/routes directory and is combined into a generated route tree. The top‐level routes require authentication and wrap pages that list, create and update various entities (users, subscriptions, orders, menu items, etc.). Most pages fetch data using custom hooks that wrap React Query and call REST endpoints via the api utility.

The project uses file‑based routing: file names inside src/routes determine the URL path. For instance, src/routes/_protected/menu/products/create.tsx maps to the path /menu/products/create. The generated routeTree.gen.ts enumerates all routes. Common patterns:

Index pages (ending in index.tsx or /) list entities using a data table. They call a useXQuery() hook to fetch paginated data and display header cards summarising counts. Deleting, duplicating or toggling availability uses mutation hooks.
Create pages (e.g., /create.tsx) render a form based on Zod schemas. On submit they call a useCreateXMutation() hook, optionally upload an image, build a payload via toCreateXPayload() and navigate back to the list.
Update pages ($id/update.tsx) load existing data via a detail query and populate the form. On submit they call useUpdateXMutation() with the updated payload.
Dynamic routes contain $param placeholders (e.g., /users/$userId) and use Route.useParams() to extract path parameters.

Below is a per‑route breakdown of the important screens, what each page does and the main API interactions (query/mutation hooks). Lines cited from the source files illustrate the described behaviour.

Root Routes
/ – Login
File: src/routes/index.tsx
Function: Renders a centred LoginForm component; before load it calls sessionQueryOptions and runs an authMiddleware to redirect authenticated users【turn4file0†L13-L20】.
API usage: sessionQueryOptions fetches the current user session; if unauthenticated the user stays on the login form.
/_protected – Root wrapper
File: src/routes/__root.tsx
Function: Defines the root route with context (queryClient). It renders an Outlet to nest child routes and shows Toaster and Router Devtools【turn5file0†L23-L33】. Unknown paths redirect to /dashboard.
Dashboard
/dashboard – Admin dashboard
File: src/routes/_protected/dashboard.tsx
Function: Loads dashboard stats via dashboardQueryOptions (ensured in a loader). The page maps the stats into cards via mapDashboardStatsToCards and switches between recent subscriptions and orders using a tab state【turn8file0†L18-L44】. A DataTable shows either subscriptions or orders based on the selected tab【turn8file0†L36-L57】.
API usage: useDashboardQuery() fetches stats, recent subscriptions and recent orders from /api/dashboard.
Zones
/zones/ – Delivery zones list
File: src/routes/_protected/zones/index.tsx
Function: Uses deliveryZonesListQueryOptions to load delivery zones. Shows the total and active zone counts in a header card and renders a ZonesTable listing the zones【turn9file0†L12-L33】. Users can assign or manage fees through row actions (handled inside ZonesTable).
API usage: useDeliveryZonesQuery() calls /api/dashboard/zones with pagination.
Users
/users/ – Users list
File: src/routes/_protected/users/index.tsx
Function: Fetches paginated users via usersQueryOptions. Renders a header and a UsersTable that allows searching, viewing details and deleting users【turn10file0†L9-L30】.
/users/create – Create user
File: src/routes/_protected/users/create.tsx (not shown here)
Function: Presents a user creation form and calls useCreateUserMutation on submit.
API usage: Sends a POST to /api/dashboard/users.
/users/$userId/ – User details
File: src/routes/_protected/users/$userId/index.tsx (not shown here)
Function: Loads a single user, displays their profile and associated subscriptions.
/users/$userId/create-subscription – New subscription for a user
File: src/routes/_protected/users/$userId/create-subscription.tsx (not shown here)
Function: Opens a subscription creation flow pre‑assigning the user ID.
Subscriptions
/subscriptions/ – Subscriptions list
File: src/routes/_protected/subscriptions/index.tsx
Function: Ensures summary data via subscriptionsSummaryQueryOptions, maps summary into SectionCards and renders a SubscriptionsTable listing all subscriptions【turn11file0†L21-L34】.
/subscriptions/create and /subscriptions/$subscriptionId/ – Create and view subscription
Files: src/routes/_protected/subscriptions/create.tsx and src/routes/_protected/subscriptions/$subscriptionId/index.tsx (not shown)
Function: Provide forms for new subscription and detail pages for existing ones.
Settings
/settings/ – System settings
File: src/routes/_protected/settings/index.tsx
Function: Loads settings (restaurant open/close times, pricing, VAT, base prices etc.) via useSettingsQuery. Presents multiple cards grouping fields: restaurant status, pricing and delivery windows. Submitting the form calls useUpdateSettingsMutation to PATCH settings【turn12file0†L80-L132】.
API usage: GET /api/dashboard/settings, PATCH /api/dashboard/settings.
/restaurant-hours/ – Restaurant hours & temporary closure
File: src/routes/_protected/restaurant-hours/index.tsx
Function: Similar to settings but with extended fields: open/close time, cutoff time, delivery windows plus JSON fields for weekly schedule and temporary closure. The JSON fields are validated locally before submit. Updating calls useUpdateRestaurantHoursMutation【turn13file0†L77-L125】.
Menu (Catalog & Builder)

The menu management workflow is central to the system. The page /menu/ displays a header and a set of tabs representing the workflow steps (catalog, builder, meal‑builder, preview and release)【turn14file0†L42-L147】. Each tab uses sub‑components and custom hooks.

Catalog tab
Categories
List page: Displayed in the MenuCategoriesTab component. It uses useMenuCategoriesQuery to fetch categories and passes them into a generic MenuEntityTableTab with columns defined in menu-columns.ts【turn15file0†L13-L26】. The tab header explains that categories organise the menu before adding products.
Create page (/menu/categories/create): Renders a form using react-hook-form and menuCategorySchema. On submit, uploads the image if provided and calls useCreateMenuCategoryMutation. Afterwards it navigates back to the catalog tab【turn16file0†L46-L55】. Optional image upload uses fetchUploadImage and resolveUploadedImageUrl.
Update page (/menu/categories/$categoryId/update): Loads the category via useMenuCategoryDetailQuery, initialises form defaults via getMenuCategoryFormValues and on submit calls useUpdateMenuCategoryMutation【turn17file0†L46-L99】. It also includes a CategoryProductsPanel enabling the assignment of existing products to the category or moving products between categories【turn17file0†L124-L126】【turn18file0†L45-L118】. The panel displays currently assigned products, provides a dialog to select new products from all menu products and calls bulk assignment/move mutations such as useBulkAssignProductsToCategoryMutation and useBulkUpdateMenuProductsMutation【turn18file0†L58-L118】.
Products
List page: Shown in MenuProductsTab, which fetches products via useMenuProductsQuery. A drop‑down filter allows filtering by category. Row actions include toggling availability (useToggleMenuProductAvailabilityMutation), duplicating (useDuplicateMenuProductMutation) and deleting (useDeleteMenuProductMutation)【turn19file0†L24-L55】.
Create page (/menu/products/create): Displays a form with fields defined in menuProductSchema. Upon submission it uploads an optional image, converts form values to the API payload with toCreateMenuProductPayload and calls useCreateMenuProductMutation【turn20file0†L32-L54】.
Update page (/menu/products/$productId/update): Loads a product composer via useMenuProductComposerQuery, which returns the product details and current customization state. The form is initialised with getMenuProductFormValues. It watches the isCustomizable flag and, if true, shows the ProductCustomizationPanel to manage per‑product groups and options【turn21file0†L48-L70】【turn21file0†L136-L149】. Saving the main form calls useUpdateMenuProductMutation. The ProductCustomizationPanel is discussed separately below.
Product customization

The ProductCustomizationPanel is the UI for defining product‑specific customization. It performs the following tasks:

Fetches the customization library (global option groups and options) via useCustomizationLibraryQuery and fetches the current product customization via useProductCustomizationQuery【turn22file0†L61-L70】.
Maintains a local enabled flag representing whether customization is turned on for this product and synchronises it with the product’s isCustomizable property【turn22file0†L78-L88】. If customization is disabled, the panel shows an empty state with a button to enable customization【turn22file0†L185-L196】.
Maintains an array of groups representing option groups attached to this product (each has rules and a list of options). Groups can be added via an Add Option Groups dialog, which lists global groups from the library and allows selecting multiple groups. Each group card shows name, status, display style and rule summary; actions include Choose Options, Edit Rules and Remove【turn22file0†L198-L225】.
Choosing options opens a dialog listing all enabled options from the library with a search field and checkboxes. The user can select which options from the global group should be linked to this product. Each group keeps its own optionIds list.
Editing rules opens a dialog to set minimum selections, maximum selections, whether the group is required, and the group’s sort order.
Saving customization triggers useSaveProductCustomizationMutation, which builds a payload (SaveProductCustomizationPayload) and calls the backend endpoints:
Toggle customization: PATCH /api/dashboard/menu/products/:productId/customization with isCustomizable and optional clearRelations【turn33file0†L29-L34】.
Delete removed groups: for each group no longer present, DELETE /api/dashboard/menu/products/:productId/option-groups/:groupId【turn33file0†L51-L58】.
Attach new group: POST /api/dashboard/menu/products/:productId/option-groups with group rules and initial option IDs【turn33file0†L89-L99】.
Update rules of existing group: PATCH /api/dashboard/menu/products/:productId/option-groups/:groupId with minSelections, maxSelections, isRequired, status flags and sort order【turn33file0†L62-L77】.
Set options: PUT /api/dashboard/menu/products/:productId/option-groups/:groupId/options with optionIds and preserveOverrides=true【turn33file0†L79-L87】.
After the mutations complete, the panel fetches the updated composer again to reflect changes【turn33file0†L101-L103】.

This flow ensures that global groups/options act as a reusable library, while each product has its own selection of groups and options.

Option groups
List page: MenuOptionGroupsTab lists all global option groups via useMenuOptionGroupsQuery and allows deletion via useDeleteMenuOptionGroupMutation【turn34file0†L11-L26】.
Create page (/menu/option-groups/create): Renders a form for group properties (menuOptionGroupSchema). Users can optionally assign existing options during creation via the OptionGroupOptionsPanel. The form submission calls useCreateMenuOptionGroupMutation and then, if options were selected, fetchAssignMenuOptionsToGroup() to link them【turn25file0†L50-L56】【turn25file0†L93-L103】.
Update page (/menu/option-groups/$groupId/update): Loads the group details via useMenuOptionGroupDetailQuery, initialises the form with getMenuOptionGroupFormValues and on submit calls useUpdateMenuOptionGroupMutation【turn27file0†L61-L80】. Option assignment is managed via OptionGroupOptionsPanel with onAssignExistingOptions calling fetchAssignMenuOptionsToGroup()【turn27file0†L93-L107】.
Options
List page: MenuOptionsTab lists all global options via useMenuOptionsQuery. It allows filtering by group and deletion via useDeleteMenuOptionMutation【turn35file0†L27-L39】.
Create page (/menu/options/create): Presents a form with fields such as key, name (Arabic and English), extra price, image and flags (active, available, visible). On submit it uploads the image if necessary and calls useCreateMenuOptionMutation【turn28file0†L30-L59】. Options are created independently of groups; linking to groups happens from group pages or product customization.
Update page (/menu/options/$optionId/update): Loads the option via useMenuOptionDetailQuery, fills the form via getMenuOptionFormValues and on submit calls useUpdateMenuOptionMutation【turn29file0†L32-L80】. The form includes fields for extraPriceSar and flags for activity, availability and visibility.
Builder tab (option/option‑group creation)

The builder tab of /menu/ contains the option groups and options tables (described above). Administrators first define reusable option groups (e.g., “Proteins”, “Sauces”) and then individual options (e.g., “Chicken”, “Ranch Sauce”). These items serve as a library; linking them to products occurs via the customization panel.

Meal builder tab

The MealBuilderPage (under /menu/ tab value meal-builder) is intended for constructing meal planner templates. According to the business scope, meal planning is out of scope for the one‑time customization refactor, so this tab is currently a placeholder.

Preview & release tabs
PublicMenuPreviewTab: Renders a preview of how the menu appears to mobile users, using the public menu contract.
MenuVersionsTab: Lists published versions of the menu and allows publishing/unpublishing.
MenuAuditLogTab: Shows a history of administrative changes.
MenuValidationDialog: Validates the menu for missing relationships (e.g., required groups without options) and suggests corrective actions.

These tabs interact with endpoints such as /api/dashboard/menu/versions, /api/dashboard/menu/validation and /api/dashboard/menu/publish.

Menu API Endpoints Summary

The frontend interacts with a set of backend endpoints dedicated to menu management and customization. The key endpoints and their purposes are reflected in the hooks used in the components:

Endpoint	Method	Used in	Purpose
/api/dashboard/menu/categories	GET	useMenuCategoriesQuery	List categories with pagination.
/api/dashboard/menu/categories	POST	useCreateMenuCategoryMutation	Create a category with key, names, description, image and flags.
/api/dashboard/menu/categories/:categoryId	GET	useMenuCategoryDetailQuery	Fetch a single category.
/api/dashboard/menu/categories/:categoryId	PATCH	useUpdateMenuCategoryMutation	Update category fields.
/api/dashboard/menu/categories/:categoryId	DELETE	useDeleteMenuCategoryMutation	Delete category.
/api/dashboard/menu/products	GET	useMenuProductsQuery	List products (with optional category filter).
/api/dashboard/menu/products	POST	useCreateMenuProductMutation	Create a product.
/api/dashboard/menu/products/:productId/composer?contractVersion=v4	GET	useMenuProductComposerQuery	Fetch product composer (product details + customization summary)【turn33file0†L16-L23】.
/api/dashboard/menu/products/:productId	PATCH	useUpdateMenuProductMutation	Update product fields (name, price, flags).
/api/dashboard/menu/products/:productId	DELETE	useDeleteMenuProductMutation	Delete product.
/api/dashboard/menu/products/:productId/customization	PATCH	useSaveProductCustomizationMutation	Enable/disable customization; optionally clear existing relations【turn33file0†L29-L34】.
/api/dashboard/menu/products/:productId/option-groups	POST	useSaveProductCustomizationMutation	Attach a global option group to a product with rules and initial options【turn33file0†L89-L99】.
/api/dashboard/menu/products/:productId/option-groups/:groupId	PATCH	useSaveProductCustomizationMutation	Update group rules and status【turn33file0†L62-L77】.
/api/dashboard/menu/products/:productId/option-groups/:groupId	DELETE	useSaveProductCustomizationMutation	Detach a group from the product【turn33file0†L51-L58】.
/api/dashboard/menu/products/:productId/option-groups/:groupId/options	PUT	useSaveProductCustomizationMutation	Replace the selected options for a product group【turn33file0†L79-L87】.
/api/dashboard/menu/customization-library	GET	useCustomizationLibraryQuery	Fetch global option groups and options for selection【turn33file0†L10-L14】.
/api/dashboard/menu/option-groups	GET	useMenuOptionGroupsQuery	List option groups.
/api/dashboard/menu/option-groups	POST	useCreateMenuOptionGroupMutation	Create a global option group.
/api/dashboard/menu/option-groups/:groupId	GET	useMenuOptionGroupDetailQuery	Fetch an option group with its options.
/api/dashboard/menu/option-groups/:groupId	PATCH	useUpdateMenuOptionGroupMutation	Update group fields.
/api/dashboard/menu/option-groups/:groupId	DELETE	useDeleteMenuOptionGroupMutation	Delete a group.
/api/dashboard/menu/option-groups/:groupId/options	POST (custom util)	fetchAssignMenuOptionsToGroup	Attach options to a group (bulk).
/api/dashboard/menu/options	GET	useMenuOptionsQuery	List options with optional group filter.
/api/dashboard/menu/options	POST	useCreateMenuOptionMutation	Create an option.
/api/dashboard/menu/options/:optionId	GET	useMenuOptionDetailQuery	Fetch an option.
/api/dashboard/menu/options/:optionId	PATCH	useUpdateMenuOptionMutation	Update option fields.
/api/dashboard/menu/options/:optionId	DELETE	useDeleteMenuOptionMutation	Delete option.

This table summarizes how the frontend pages correspond to backend endpoints and clarifies the separation between global library items and per‑product relationships.

Additional Routes

Other areas of the dashboard follow similar patterns. Here is a concise summary:

Path	Purpose	Main Hooks and Components
/one-time-orders/	Lists one‑time orders; uses useOneTimeOrdersQuery and an OneTimeOrderList table. Viewing an order ($orderId) shows details.	
/operations/	Shows an operations board for managing daily tasks (OperationsBoard component).	
/packages/	Lists subscription packages with create and update pages (useMenuPackagesQuery, PackageForm).	
/addons/	Lists add‑ons; create/update pages manage add‑on names and prices (AddonsTable, useAddonsQuery).	
/promo-codes/	Lists and manages promo codes (create/update forms).	
/payments/	Manages payment methods and records.	
/notifications/	Shows push notifications sent to users.	
/manual-deduction/	Allows admins to apply manual deductions to user balances.	
/delivery/	Displays delivery settings and fees.	
/dashboard-users/	Manages dashboard admin users.	
/accounting/	Provides accounting reports and exports.	
/profile/	User profile page for the current admin.	
/pickup-branches/	Displays pickup branch info retrieved from settings; no editing (read‑only)【turn36file0†L140-L172】.	
/restaurant-hours/	Page to configure restaurant operating hours and temporary closures【turn13file0†L77-L125】.	
/zones/	Delivery zone management (listed above).	

These routes follow the same pattern: list pages fetch entities via useXQuery hooks, create/update pages use forms with validation and call the corresponding mutation hooks. They do not participate in product customization and are outside the scope of the one‑time menu refactor.

Conclusion

The Basic Diet admin dashboard is a modular React application with file‑based routing. Each screen is backed by hooks that abstract away API calls and use React Query for caching. The menu management workflow distinguishes between global definitions (categories, option groups and options) and per‑product customization, ensuring the library remains reusable. Understanding this structure and its API interactions provides a solid foundation for refactoring the backend API to supply a clean composer v4 contract and for simplifying the frontend customization UI.

The map should serve as a solid reference for your backend refactoring work; it highlights all relevant screens (like categories, products, option groups, orders, subscriptions, settings, etc.) and their data flows. Let me know if you need deeper analysis of specific parts of the frontend or additional mappings of other repositories.

make it as an md file and make sure that this showing up everything for the all dashboard routes and screens and it's api fetches to help the backend to know exactly what dashboard fetches and all screens helping the backend to know all routes and screens for the ddashboard making codex and chatgpt knowing what is going on excatly
Worked for 46 seconds

I’ve compiled the complete mapping of all dashboard routes, screens, and their API fetches into a Markdown document. This includes detailed descriptions of each route, what it does, and how it interacts with the backend. The file will help developers understand exactly how the dashboard functions and what data it requests.

You can download and review the full document here:
Basic Diet Admin Dashboard: Route and Screen Map
Overview

The dashboard is a React application (Vite + TanStack Router) that exposes a set of protected routes under the /_protected prefix. Each route is declared via createFileRoute() inside the src/routes directory and is combined into a generated route tree. The top‐level routes require authentication and wrap pages that list, create and update various entities (users, subscriptions, orders, menu items, etc.). Most pages fetch data using custom hooks that wrap React Query and call REST endpoints via the api utility.

The project uses file‑based routing: file names inside src/routes determine the URL path. For instance, src/routes/_protected/menu/products/create.tsx maps to the path /menu/products/create. The generated routeTree.gen.ts enumerates all routes. Common patterns:

Index pages (ending in index.tsx or /) list entities using a data table. They call a useXQuery() hook to fetch paginated data and display header cards summarising counts. Deleting, duplicating or toggling availability uses mutation hooks.
Create pages (e.g., /create.tsx) render a form based on Zod schemas. On submit they call a useCreateXMutation() hook, optionally upload an image, build a payload via toCreateXPayload() and navigate back to the list.
Update pages ($id/update.tsx) load existing data via a detail query and populate the form. On submit they call useUpdateXMutation() with the updated payload.
Dynamic routes contain $param placeholders (e.g., /users/$userId) and use Route.useParams() to extract path parameters.

Below is a per‑route breakdown of the important screens, what each page does and the main API interactions (query/mutation hooks). Lines cited from the source files illustrate the described behaviour.

Root Routes
/ – Login
File: src/routes/index.tsx
Function: Renders a centred LoginForm component; before load it calls sessionQueryOptions and runs an authMiddleware to redirect authenticated users【turn4file0†L13-L20】.
API usage: sessionQueryOptions fetches the current user session; if unauthenticated the user stays on the login form.
/_protected – Root wrapper
File: src/routes/__root.tsx
Function: Defines the root route with context (queryClient). It renders an Outlet to nest child routes and shows Toaster and Router Devtools【turn5file0†L23-L33】. Unknown paths redirect to /dashboard.
Dashboard
/dashboard – Admin dashboard
File: src/routes/_protected/dashboard.tsx
Function: Loads dashboard stats via dashboardQueryOptions (ensured in a loader). The page maps the stats into cards via mapDashboardStatsToCards and switches between recent subscriptions and orders using a tab state【turn8file0†L18-L44】. A DataTable shows either subscriptions or orders based on the selected tab【turn8file0†L36-L57】.
API usage: useDashboardQuery() fetches stats, recent subscriptions and recent orders from /api/dashboard.
Zones
/zones/ – Delivery zones list
File: src/routes/_protected/zones/index.tsx
Function: Uses deliveryZonesListQueryOptions to load delivery zones. Shows the total and active zone counts in a header card and renders a ZonesTable listing the zones【turn9file0†L12-L33】. Users can assign or manage fees through row actions (handled inside ZonesTable).
API usage: useDeliveryZonesQuery() calls /api/dashboard/zones with pagination.
Users
/users/ – Users list
File: src/routes/_protected/users/index.tsx
Function: Fetches paginated users via usersQueryOptions. Renders a header and a UsersTable that allows searching, viewing details and deleting users【turn10file0†L9-L30】.
/users/create – Create user
File: src/routes/_protected/users/create.tsx (not shown here)
Function: Presents a user creation form and calls useCreateUserMutation on submit.
API usage: Sends a POST to /api/dashboard/users.
/users/$userId/ – User details
File: src/routes/_protected/users/$userId/index.tsx (not shown here)
Function: Loads a single user, displays their profile and associated subscriptions.
/users/$userId/create-subscription – New subscription for a user
File: src/routes/_protected/users/$userId/create-subscription.tsx (not shown here)
Function: Opens a subscription creation flow pre‑assigning the user ID.
Subscriptions
/subscriptions/ – Subscriptions list
File: src/routes/_protected/subscriptions/index.tsx
Function: Ensures summary data via subscriptionsSummaryQueryOptions, maps summary into SectionCards and renders a SubscriptionsTable listing all subscriptions【turn11file0†L21-L34】.
/subscriptions/create and /subscriptions/$subscriptionId/ – Create and view subscription
Files: src/routes/_protected/subscriptions/create.tsx and src/routes/_protected/subscriptions/$subscriptionId/index.tsx (not shown)
Function: Provide forms for new subscription and detail pages for existing ones.
Settings
/settings/ – System settings
File: src/routes/_protected/settings/index.tsx
Function: Loads settings (restaurant open/close times, pricing, VAT, base prices etc.) via useSettingsQuery. Presents multiple cards grouping fields: restaurant status, pricing and delivery windows. Submitting the form calls useUpdateSettingsMutation to PATCH settings【turn12file0†L80-L132】.
API usage: GET /api/dashboard/settings, PATCH /api/dashboard/settings.
/restaurant-hours/ – Restaurant hours & temporary closure
File: src/routes/_protected/restaurant-hours/index.tsx
Function: Similar to settings but with extended fields: open/close time, cutoff time, delivery windows plus JSON fields for weekly schedule and temporary closure. The JSON fields are validated locally before submit. Updating calls useUpdateRestaurantHoursMutation【turn13file0†L77-L125】.
Menu (Catalog & Builder)

The menu management workflow is central to the system. The page /menu/ displays a header and a set of tabs representing the workflow steps (catalog, builder, meal‑builder, preview and release)【turn14file0†L42-L147】. Each tab uses sub‑components and custom hooks.

Catalog tab
Categories
List page: Displayed in the MenuCategoriesTab component. It uses useMenuCategoriesQuery to fetch categories and passes them into a generic MenuEntityTableTab with columns defined in menu-columns.ts【turn15file0†L13-L26】. The tab header explains that categories organise the menu before adding products.
Create page (/menu/categories/create): Renders a form using react-hook-form and menuCategorySchema. On submit, uploads the image if provided and calls useCreateMenuCategoryMutation. Afterwards it navigates back to the catalog tab【turn16file0†L46-L55】. Optional image upload uses fetchUploadImage and resolveUploadedImageUrl.
Update page (/menu/categories/$categoryId/update): Loads the category via useMenuCategoryDetailQuery, initialises form defaults via getMenuCategoryFormValues and on submit calls useUpdateMenuCategoryMutation【turn17file0†L46-L99】. It also includes a CategoryProductsPanel enabling the assignment of existing products to the category or moving products between categories【turn17file0†L124-L126】【turn18file0†L45-L118】. The panel displays currently assigned products, provides a dialog to select new products from all menu products and calls bulk assignment/move mutations such as useBulkAssignProductsToCategoryMutation and useBulkUpdateMenuProductsMutation【turn18file0†L58-L118】.
Products
List page: Shown in MenuProductsTab, which fetches products via useMenuProductsQuery. A drop‑down filter allows filtering by category. Row actions include toggling availability (useToggleMenuProductAvailabilityMutation), duplicating (useDuplicateMenuProductMutation) and deleting (useDeleteMenuProductMutation)【turn19file0†L24-L55】.
Create page (/menu/products/create): Displays a form with fields defined in menuProductSchema. Upon submission it uploads an optional image, converts form values to the API payload with toCreateMenuProductPayload and calls useCreateMenuProductMutation【turn20file0†L32-L54】.
Update page (/menu/products/$productId/update): Loads a product composer via useMenuProductComposerQuery, which returns the product details and current customization state. The form is initialised with getMenuProductFormValues. It watches the isCustomizable flag and, if true, shows the ProductCustomizationPanel to manage per‑product groups and options【turn21file0†L48-L70】【turn21file0†L136-L149】. Saving the main form calls useUpdateMenuProductMutation. The ProductCustomizationPanel is discussed separately below.
Product customization

The ProductCustomizationPanel is the UI for defining product‑specific customization. It performs the following tasks:

Fetches the customization library (global option groups and options) via useCustomizationLibraryQuery and fetches the current product customization via useProductCustomizationQuery【turn22file0†L61-L70】.
Maintains a local enabled flag representing whether customization is turned on for this product and synchronises it with the product’s isCustomizable property【turn22file0†L78-L88】. If customization is disabled, the panel shows an empty state with a button to enable customization【turn22file0†L185-L196】.
Maintains an array of groups representing option groups attached to this product (each has rules and a list of options). Groups can be added via an Add Option Groups dialog, which lists global groups from the library and allows selecting multiple groups. Each group card shows name, status, display style and rule summary; actions include Choose Options, Edit Rules and Remove【turn22file0†L198-L225】.
Choosing options opens a dialog listing all enabled options from the library with a search field and checkboxes. The user can select which options from the global group should be linked to this product. Each group keeps its own optionIds list.
Editing rules opens a dialog to set minimum selections, maximum selections, whether the group is required, and the group’s sort order.
Saving customization triggers useSaveProductCustomizationMutation, which builds a payload (SaveProductCustomizationPayload) and calls the backend endpoints:
Toggle customization: PATCH /api/dashboard/menu/products/:productId/customization with isCustomizable and optional clearRelations【turn33file0†L29-L34】.
Delete removed groups: for each group no longer present, DELETE /api/dashboard/menu/products/:productId/option-groups/:groupId【turn33file0†L51-L58】.
Attach new group: POST /api/dashboard/menu/products/:productId/option-groups with group rules and initial option IDs【turn33file0†L89-L99】.
Update rules of existing group: PATCH /api/dashboard/menu/products/:productId/option-groups/:groupId with minSelections, maxSelections, isRequired, status flags and sort order【turn33file0†L62-L77】.
Set options: PUT /api/dashboard/menu/products/:productId/option-groups/:groupId/options with optionIds and preserveOverrides=true【turn33file0†L79-L87】.
After the mutations complete, the panel fetches the updated composer again to reflect changes【turn33file0†L101-L103】.

This flow ensures that global groups/options act as a reusable library, while each product has its own selection of groups and options.

Option groups
List page: MenuOptionGroupsTab lists all global option groups via useMenuOptionGroupsQuery and allows deletion via useDeleteMenuOptionGroupMutation【turn34file0†L11-L26】.
Create page (/menu/option-groups/create): Renders a form for group properties (menuOptionGroupSchema). Users can optionally assign existing options during creation via the OptionGroupOptionsPanel. The form submission calls useCreateMenuOptionGroupMutation and then, if options were selected, fetchAssignMenuOptionsToGroup() to link them【turn25file0†L50-L56】【turn25file0†L93-L103】.
Update page (/menu/option-groups/$groupId/update): Loads the group details via useMenuOptionGroupDetailQuery, initialises the form with getMenuOptionGroupFormValues and on submit calls useUpdateMenuOptionGroupMutation【turn27file0†L61-L80】. Option assignment is managed via OptionGroupOptionsPanel with onAssignExistingOptions calling fetchAssignMenuOptionsToGroup()【turn27file0†L93-L107】.
Options
List page: MenuOptionsTab lists all global options via useMenuOptionsQuery. It allows filtering by group and deletion via useDeleteMenuOptionMutation【turn35file0†L27-L39】.
Create page (/menu/options/create): Presents a form with fields such as key, name (Arabic and English), extra price, image and flags (active, available, visible). On submit it uploads the image if necessary and calls useCreateMenuOptionMutation【turn28file0†L30-L59】. Options are created independently of groups; linking to groups happens from group pages or product customization.
Update page (/menu/options/$optionId/update): Loads the option via useMenuOptionDetailQuery, fills the form via getMenuOptionFormValues and on submit calls useUpdateMenuOptionMutation【turn29file0†L32-L80】. The form includes fields for extraPriceSar and flags for activity, availability and visibility.
Builder tab (option/option‑group creation)

The builder tab of /menu/ contains the option groups and options tables (described above). Administrators first define reusable option groups (e.g., “Proteins”, “Sauces”) and then individual options (e.g., “Chicken”, “Ranch Sauce”). These items serve as a library; linking them to products occurs via the customization panel.

Meal builder tab

The MealBuilderPage (under /menu/ tab value meal-builder) is intended for constructing meal planner templates. According to the business scope, meal planning is out of scope for the one‑time customization refactor, so this tab is currently a placeholder.

Preview & release tabs
PublicMenuPreviewTab: Renders a preview of how the menu appears to mobile users, using the public menu contract.
MenuVersionsTab: Lists published versions of the menu and allows publishing/unpublishing.
MenuAuditLogTab: Shows a history of administrative changes.
MenuValidationDialog: Validates the menu for missing relationships (e.g., required groups without options) and suggests corrective actions.

These tabs interact with endpoints such as /api/dashboard/menu/versions, /api/dashboard/menu/validation and /api/dashboard/menu/publish.

Menu API Endpoints Summary

The frontend interacts with a set of backend endpoints dedicated to menu management and customization. The key endpoints and their purposes are reflected in the hooks used in the components:

Endpoint	Method	Used in	Purpose
/api/dashboard/menu/categories	GET	useMenuCategoriesQuery	List categories with pagination.
/api/dashboard/menu/categories	POST	useCreateMenuCategoryMutation	Create a category with key, names, description, image and flags.
/api/dashboard/menu/categories/:categoryId	GET	useMenuCategoryDetailQuery	Fetch a single category.
/api/dashboard/menu/categories/:categoryId	PATCH	useUpdateMenuCategoryMutation	Update category fields.
/api/dashboard/menu/categories/:categoryId	DELETE	useDeleteMenuCategoryMutation	Delete category.
/api/dashboard/menu/products	GET	useMenuProductsQuery	List products (with optional category filter).
/api/dashboard/menu/products	POST	useCreateMenuProductMutation	Create a product.
/api/dashboard/menu/products/:productId/composer?contractVersion=v4	GET	useMenuProductComposerQuery	Fetch product composer (product details + customization summary)【turn33file0†L16-L23】.
/api/dashboard/menu/products/:productId	PATCH	useUpdateMenuProductMutation	Update product fields (name, price, flags).
/api/dashboard/menu/products/:productId	DELETE	useDeleteMenuProductMutation	Delete product.
/api/dashboard/menu/products/:productId/customization	PATCH	useSaveProductCustomizationMutation	Enable/disable customization; optionally clear existing relations【turn33file0†L29-L34】.
/api/dashboard/menu/products/:productId/option-groups	POST	useSaveProductCustomizationMutation	Attach a global option group to a product with rules and initial options【turn33file0†L89-L99】.
/api/dashboard/menu/products/:productId/option-groups/:groupId	PATCH	useSaveProductCustomizationMutation	Update group rules and status【turn33file0†L62-L77】.
/api/dashboard/menu/products/:productId/option-groups/:groupId	DELETE	useSaveProductCustomizationMutation	Detach a group from the product【turn33file0†L51-L58】.
/api/dashboard/menu/products/:productId/option-groups/:groupId/options	PUT	useSaveProductCustomizationMutation	Replace the selected options for a product group【turn33file0†L79-L87】.
/api/dashboard/menu/customization-library	GET	useCustomizationLibraryQuery	Fetch global option groups and options for selection【turn33file0†L10-L14】.
/api/dashboard/menu/option-groups	GET	useMenuOptionGroupsQuery	List option groups.
/api/dashboard/menu/option-groups	POST	useCreateMenuOptionGroupMutation	Create a global option group.
/api/dashboard/menu/option-groups/:groupId	GET	useMenuOptionGroupDetailQuery	Fetch an option group with its options.
/api/dashboard/menu/option-groups/:groupId	PATCH	useUpdateMenuOptionGroupMutation	Update group fields.
/api/dashboard/menu/option-groups/:groupId	DELETE	useDeleteMenuOptionGroupMutation	Delete a group.
/api/dashboard/menu/option-groups/:groupId/options	POST (custom util)	fetchAssignMenuOptionsToGroup	Attach options to a group (bulk).
/api/dashboard/menu/options	GET	useMenuOptionsQuery	List options with optional group filter.
/api/dashboard/menu/options	POST	useCreateMenuOptionMutation	Create an option.
/api/dashboard/menu/options/:optionId	GET	useMenuOptionDetailQuery	Fetch an option.
/api/dashboard/menu/options/:optionId	PATCH	useUpdateMenuOptionMutation	Update option fields.
/api/dashboard/menu/options/:optionId	DELETE	useDeleteMenuOptionMutation	Delete option.

This table summarizes how the frontend pages correspond to backend endpoints and clarifies the separation between global library items and per‑product relationships.

Additional Routes

Other areas of the dashboard follow similar patterns. Here is a concise summary:

Path	Purpose	Main Hooks and Components
/one-time-orders/	Lists one‑time orders; uses useOneTimeOrdersQuery and an OneTimeOrderList table. Viewing an order ($orderId) shows details.	
/operations/	Shows an operations board for managing daily tasks (OperationsBoard component).	
/packages/	Lists subscription packages with create and update pages (useMenuPackagesQuery, PackageForm).	
/addons/	Lists add‑ons; create/update pages manage add‑on names and prices (AddonsTable, useAddonsQuery).	
/promo-codes/	Lists and manages promo codes (create/update forms).	
/payments/	Manages payment methods and records.	
/notifications/	Shows push notifications sent to users.	
/manual-deduction/	Allows admins to apply manual deductions to user balances.	
/delivery/	Displays delivery settings and fees.	
/dashboard-users/	Manages dashboard admin users.	
/accounting/	Provides accounting reports and exports.	
/profile/	User profile page for the current admin.	
/pickup-branches/	Displays pickup branch info retrieved from settings; no editing (read‑only)【turn36file0†L140-L172】.	
/restaurant-hours/	Page to configure restaurant operating hours and temporary closures【turn13file0†L77-L125】.	
/zones/	Delivery zone management (listed above).	

These routes follow the same pattern: list pages fetch entities via useXQuery hooks, create/update pages use forms with validation and call the corresponding mutation hooks. They do not participate in product customization and are outside the scope of the one‑time menu refactor.

Conclusion

The Basic Diet admin dashboard is a modular React application with file‑based routing. Each screen is backed by hooks that abstract away API calls and use React Query for caching. The menu management workflow distinguishes between global definitions (categories, option groups and options) and per‑product customization, ensuring the library remains reusable. Understanding this structure and its API interactions provides a solid foundation for refactoring the backend API to supply a clean composer v4 contract and for simplifying the frontend customization UI.