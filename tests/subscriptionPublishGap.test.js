const assert = require("assert");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");
const CatalogService = require("../src/services/catalog/CatalogService");
const MenuOption = require("../src/models/MenuOption");
const MenuOptionGroup = require("../src/models/MenuOptionGroup");
const MenuProduct = require("../src/models/MenuProduct");
const { publishMenu } = require("../src/services/orders/menuCatalogService");

describe("Subscription Publish Gap Regression", function() {
  let mongoServer;

  before(async function() {
    mongoServer = await MongoMemoryServer.create();
    const uri = mongoServer.getUri();
    await mongoose.connect(uri);
  });

  after(async function() {
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  it("should not show unpublished items in subscription catalog, but show them after publish", async function() {
    // 1. Setup: Create a MenuOptionGroup (published)
    const group = await MenuOptionGroup.create({
      key: "proteins",
      name: { en: "Proteins", ar: "بروتينات" },
      isActive: true,
      publishedAt: new Date()
    });

    // 2. Create a new MenuOption with publishedAt = null
    const unpublishedOption = await MenuOption.create({
      groupId: group._id,
      key: "unpublished_protein",
      name: { en: "Unpublished Protein", ar: "بروتين غير منشور" },
      isActive: true,
      availableFor: ["subscription"],
      availableForSubscription: true,
      publishedAt: null // Explicitly null
    });

    // 3. Call subscription catalog endpoint (internal service call)
    let catalog = await CatalogService.getSubscriptionBuilderCatalog({ lang: "en" });
    
    // 4. Assert it does NOT appear
    const foundBefore = catalog.proteins.find(p => p.id === String(unpublishedOption._id)) || 
                        catalog.premiumProteins.find(p => p.id === String(unpublishedOption._id));
    assert(!foundBefore, "Unpublished option should NOT appear in catalog");

    // 5. Call publishMenu()
    await publishMenu({ actor: { role: "test" }, notes: "Test publish" });

    // 6. Call subscription catalog endpoint again
    catalog = await CatalogService.getSubscriptionBuilderCatalog({ lang: "en" });

    // 7. Assert it NOW appears
    const foundAfter = catalog.proteins.find(p => p.id === String(unpublishedOption._id)) || 
                       catalog.premiumProteins.find(p => p.id === String(unpublishedOption._id));
    assert(foundAfter, "Published option SHOULD appear in catalog after publishMenu()");
  });
});
