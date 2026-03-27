import { chromium } from 'playwright';
import { stdin } from 'process';

(async () => {
  // Launch using kayserb@simple.biz Chrome profile (Profile 2) directly
  const context = await chromium.launchPersistentContext(
    'C:\\Users\\kodib\\AppData\\Local\\Google\\Chrome\\User Data',
    {
      headless: false,
      channel: 'chrome',
      viewport: { width: 1440, height: 900 },
      args: ['--profile-directory=Profile 2'],
    }
  );

  const page = await context.newPage();
  await page.goto('https://west-3.calltools.io/agent', { waitUntil: 'networkidle', timeout: 60000 });

  console.log('\n📌 Browser opened with kayserb@simple.biz profile.');
  console.log('📌 Press ENTER here once the agent dashboard is loaded...\n');

  await new Promise(resolve => {
    stdin.resume();
    stdin.once('data', () => { stdin.pause(); resolve(); });
  });

  console.log('📸 Capturing...\n');
  await page.waitForTimeout(2000);

  await page.screenshot({ path: 'tests/manual/calltools-agent-dashboard.png', fullPage: true });
  console.log('📸 Screenshot saved');

  const colors = await page.evaluate(() => {
    const colorMap = {};
    document.querySelectorAll('*').forEach(el => {
      const styles = window.getComputedStyle(el);
      ['backgroundColor', 'color', 'borderColor'].forEach(prop => {
        const v = styles[prop];
        if (v && !['rgba(0, 0, 0, 0)', 'transparent', 'none', 'rgb(0, 0, 0)', 'rgb(255, 255, 255)'].includes(v)) {
          const tag = el.tagName.toLowerCase();
          const cls = typeof el.className === 'string' ? el.className.split(' ').filter(c=>c).slice(0,3).join('.') : '';
          if (!colorMap[v]) colorMap[v] = { count: 0, prop, els: new Set() };
          colorMap[v].count++;
          if (colorMap[v].els.size < 5) colorMap[v].els.add(`${tag}${cls?'.'+cls:''}`);
        }
      });
    });
    return Object.entries(colorMap).sort((a,b) => b[1].count - a[1].count).slice(0,50)
      .map(([c, i]) => ({ color: c, count: i.count, prop: i.prop, els: [...i.els] }));
  });

  console.log('\n🎨 COLORS:\n');
  colors.forEach(({ color, count, prop, els }) => {
    console.log(`${color.padEnd(45)} | ${prop.padEnd(18)} | x${String(count).padEnd(4)} | ${els.join(', ')}`);
  });

  const sections = await page.evaluate(() => {
    const s = {};
    const g = sel => { const e = document.querySelector(sel); return e ? window.getComputedStyle(e) : null; };
    [['Sidebar','[class*="sidebar"], mat-sidenav, mat-drawer'],['Header','mat-toolbar, [class*="toolbar"], [class*="header"]'],
     ['Primary Btn','[class*="mat-primary"], button[color="primary"]'],['Warn Btn','button[color="warn"], [class*="mat-warn"]'],
     ['Card','mat-card, [class*="card"]'],['Main','mat-drawer-content, [class*="main-content"]'],['Body','body'],
     ['Status','[class*="status"]'],['Dialer','[class*="dialer"], [class*="dial"]'],['Active Tab','.mat-tab-label-active, [class*="active"]'],
    ].forEach(([n, sel]) => {
      const cs = g(sel);
      if (cs) s[n] = { bg: cs.backgroundColor, text: cs.color, border: cs.borderColor };
    });
    return s;
  });

  console.log('\n🏗️ SECTIONS:\n');
  Object.entries(sections).forEach(([n, p]) => {
    const v = Object.entries(p).filter(([,v]) => v && v !== 'rgba(0, 0, 0, 0)' && v !== 'transparent').map(([k,v])=>`${k}:${v}`).join(' | ');
    if (v) console.log(`${n.padEnd(15)} | ${v}`);
  });

  await context.close();
  console.log('\n✅ Done!');
})();
