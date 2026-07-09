const fs = require('fs');
let code = fs.readFileSync('src/app.js', 'utf8');

const debugRoute = `
  app.get("/debug/info", async (req, res) => {
    try {
      const mongoose = require('mongoose');
      const Subscription = require('./models/Subscription');
      const sub1 = await Subscription.findById('6a4ee0ae3f09c6ea6751c9c5').lean();
      const sub2 = await Subscription.findById('6a4ee869f5f18c06748fdacc').lean();
      
      res.json({
        commit: process.env.RAILWAY_GIT_COMMIT_SHA || process.env.RENDER_GIT_COMMIT || 'unknown',
        db_host: mongoose.connection.host,
        db_name: mongoose.connection.name,
        sub1_found: !!sub1,
        sub2_found: !!sub2,
        sub2_data: sub2 ? {
          addonSubscriptions: sub2.addonSubscriptions,
          addonBalance: sub2.addonBalance
        } : null
      });
    } catch (e) {
      res.json({ error: e.message });
    }
  });
`;

if (!code.includes('/debug/info')) {
  code = code.replace('app.get("/health",', debugRoute + '\n  app.get("/health",');
  fs.writeFileSync('src/app.js', code);
  console.log('Added /debug/info');
}
