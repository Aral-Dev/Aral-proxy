/* ARAL Proxy — panel client (multi-proxy, FA/EN, dark/light) */
'use strict';

let statusData = null;
let saving = false;
let noticeTimer;
let editingProxyId = null;   // null => create mode
let refreshTimer = null;
const $ = id => document.getElementById(id);
const routeAliases = {overview: 'overview', home: 'overview', proxies: 'proxies', proxy: 'proxies', sponsor: 'proxies', links: 'proxies', bridge: 'proxies', guide: 'guide', help: 'guide'};

/* ================= i18n ================= */
const I18N = {
en: {
  'brand.tagline': 'Telegram · Owner panel',
  'login.tag': 'YOUR PRIVATE CONTROL ROOM', 'login.title': 'Welcome back.',
  'login.desc': 'Sign in to manage your proxies and sponsored channels.',
  'login.password': 'Panel password', 'login.passwordPh': 'Enter your panel password',
  'login.submit': 'Open dashboard', 'login.footer': 'Private access. Your connection stays yours.',
  'setup.tag': 'FIRST-TIME SETUP', 'setup.title': 'Make this panel yours.',
  'setup.desc': "Create your owner password. Copy the one-time setup code from this service's hosting deployment logs.",
  'setup.code': 'One-time setup code', 'setup.codePh': 'From your deployment logs',
  'setup.password': 'Choose a password', 'setup.passwordPh': 'At least 8 characters',
  'setup.confirm': 'Confirm password', 'setup.submit': 'Create owner password',
  'setup.footer': 'Keep persistent storage enabled to preserve your password and proxy links.',
  'nav.overview': 'Overview', 'nav.proxies': 'Proxies', 'nav.guide': 'Guide', 'nav.logout': 'Sign out',
  'theme.dark': 'Dark', 'theme.light': 'Light', 'theme.toDark': 'Switch to dark theme', 'theme.toLight': 'Switch to light theme',
  'overview.tag': 'ARAL PROXY / CONTROL CENTER', 'overview.title': 'Your network, at a glance.',
  'overview.desc': 'Live activity, traffic and server health across all your proxies.',
  'overview.activityEyebrow': 'LIVE PROXY ACTIVITY', 'overview.activityTitle': 'Audience & traffic',
  'overview.activityAction': 'Manage proxies ↗', 'overview.users': 'CONNECTED USERS',
  'overview.usersHelp': 'Estimated from active IPs, all proxies', 'overview.connections': 'ACTIVE CONNECTIONS',
  'overview.connectionsHelp': 'Multiple connections per device', 'overview.traffic': 'TOTAL TRAFFIC',
  'overview.trafficSaved': 'Saved across restarts', 'overview.upload': 'Upload', 'overview.download': 'Download',
  'overview.updating': 'Updating statistics...',
  'overview.updatedNote': 'Updates every 15 seconds. Users are estimated from active IPs; shared networks may count as one. Traffic includes direct and WEB proxy connections.',
  'overview.unavailable': 'Live metrics are temporarily unavailable. Saved traffic totals are retained.',
  'overview.resourcesEyebrow': 'DEPLOYMENT RESOURCES', 'overview.resourcesTitle': 'Server health',
  'overview.resourcesNote': 'Live container metrics', 'overview.liveStatus': 'Live status', 'overview.updated': 'Updated',
  'overview.refreshNote': 'Refreshes every 15 seconds', 'overview.refresh': 'Refresh',
  'resources.cpu': 'CPU', 'resources.memory': 'Memory', 'resources.disk': 'Disk',
  'resources.waiting': 'Waiting', 'resources.high': 'High', 'resources.elevated': 'Elevated', 'resources.healthy': 'Healthy', 'resources.unavailable': 'Unavailable',
  'resources.cpuDetail': 'Measuring allocated CPU', 'resources.memoryDetail': 'Container RAM usage', 'resources.diskDetail': 'Data filesystem usage',
  'resources.cpuCores': 'Of {n} allocated vCPU', 'resources.cpuUnavailable': 'Container CPU metrics unavailable',
  'resources.memoryUsed': '{used} used; no container limit reported', 'resources.memoryLimit': '{used} / {limit}',
  'resources.memoryUnavailable': 'Container memory metrics unavailable',
  'resources.diskUsed': '{used} / {total} on data filesystem', 'resources.diskDeployment': '{used} / {total} deployment storage (estimated)',
  'resources.diskUnavailable': 'Data filesystem metrics unavailable',
  'status.checking': 'Checking...', 'status.online': 'Online', 'status.starting': 'Starting', 'status.offline': 'Stopped',
  'status.uptime': 'Uptime', 'status.allOnline': '{n}/{m} proxies online', 'status.none': 'No proxies yet',
  'proxies.tag': 'FULL CONTROL', 'proxies.title': 'Your proxies',
  'proxies.desc': 'Create, edit and monitor independent proxy instances. Each one gets its own port, masking domain and connection links.',
  'proxies.add': 'New proxy', 'proxies.empty': 'No proxies yet. Create your first proxy to get connection links you can share.',
  'proxies.createFirst': 'Create the first proxy',
  'proxy.card.users': 'USERS', 'proxy.card.connections': 'CONNECTIONS', 'proxy.card.traffic': 'TRAFFIC',
  'proxy.card.port': 'Engine port', 'proxy.card.domain': 'Masking domain', 'proxy.card.links': 'Links',
  'proxy.card.qr': 'QR', 'proxy.card.edit': 'Edit', 'proxy.card.disable': 'Disable', 'proxy.card.enable': 'Enable',
  'proxy.card.default': 'Default', 'proxy.card.disabled': 'Disabled',
  'proxy.card.copyTg': 'Copy direct link', 'proxy.card.copyWeb': 'Copy HTTPS link',
  'tabs.general': 'General', 'tabs.sponsor': 'Sponsored channel', 'tabs.bridge': 'Cloudflare bridge',
  'form.name': 'Proxy name', 'form.namePh': 'Main proxy', 'form.port': 'Engine port',
  'form.portHint': 'Leave empty for automatic allocation.',
  'form.host': 'Masking domain (FakeTLS)', 'form.hostHint': 'Must be unique per proxy. Changing it changes the connection links.',
  'form.enabled': 'Proxy enabled', 'form.enabledHint': 'Disabled proxies stop accepting connections.',
  'form.saveNote': 'Port and domain changes restart this engine briefly.',
  'form.create': 'Create proxy', 'form.save': 'Save changes', 'form.creating': 'Creating...',
  'form.dangerText': 'Deleting a proxy permanently removes its links and settings. Clients stop connecting.',
  'form.delete': 'Delete proxy', 'form.deleteConfirm': 'Delete this proxy permanently? Its connection links stop working.',
  'sponsor.desc': 'Set the channel promoted inside Telegram for people using this proxy.',
  'sponsor.channel': 'Public channel', 'sponsor.fromBot': 'from @MTProxybot',
  'sponsor.enable': 'Enable sponsorship', 'sponsor.enableHint': "Switches this proxy to Telemt's middle-proxy mode.",
  'sponsor.saveNote': "Applying changes may briefly reconnect this proxy's clients.",
  'sponsor.save': 'Save changes →', 'sponsor.notEnabled': 'Not enabled', 'sponsor.configured': 'Configured',
  'sponsor.setupTitle': 'Connect it to Telegram',
  'sponsor.step1Title': 'Register your proxy', 'sponsor.step2Title': 'Choose your channel', 'sponsor.step3Title': 'Paste the promotion tag',
  'sponsor.info': 'Telegram may take about an hour to refresh a promotion. It may not appear for people already subscribed to the channel.',
  'sponsor.copyKey': 'Copy 32-character registration key',
  'sponsor.keyNote': "For the bot's secret prompt: use the bare key, without the ee prefix or hostname.",
  'bridge.title': 'WEB proxy settings', 'bridge.disabled': 'Disabled', 'bridge.enabled': 'Enabled',
  'bridge.desc': 'Telegram WEB → Cloudflare HTTPS → your panel. Requires a Telegram client with WEB proxy support.',
  'bridge.workerNote': 'Your branded Worker', 'bridge.workerHint': 'Generated automatically in your download. Sponsor channel settings remain yours to choose.',
  'bridge.origin': 'Your hosting origin (detected automatically)',
  'bridge.originNote': 'The copied Worker is already configured for this panel. No Cloudflare variables or token entry are needed.',
  'bridge.workerUrl': 'Deployed Cloudflare Worker URL', 'bridge.ipOverride': 'Advanced: endpoint IPv4 override',
  'bridge.ipLabel': 'Endpoint public IPv4', 'bridge.ipHint': 'Resolved automatically when enabled. Normally leave this empty.',
  'bridge.enable': 'Enable native WEB proxy', 'bridge.saveNote': 'Applying restarts this proxy; its clients briefly reconnect.',
  'bridge.save': 'Save bridge settings', 'bridge.copyWorker': 'Copy ready-to-deploy Worker',
  'bridge.downloadWorker': 'Download ready-to-deploy Worker', 'bridge.viewWorker': 'View Worker code / copy manually',
  'bridge.loadWorker': 'Load code', 'bridge.manualToken': 'Advanced: manual bridge token',
  'bridge.tokenLabel': 'Private bridge token', 'bridge.copyToken': 'Copy bridge token',
  'bridge.tokenNote': 'Advanced only: the ready-to-deploy Worker already includes this token. Keep the copied code private.',
  'bridge.bundle': 'Optional desktop / Wrangler bundle', 'bridge.downloadBundle': 'Download private Worker bundle',
  'bridge.phoneEyebrow': 'PHONE-FRIENDLY SETUP', 'bridge.phoneTitle': 'Copy, paste, deploy',
  'bridge.step1Title': 'Create a Cloudflare Worker', 'bridge.step2Title': 'Paste the standalone code', 'bridge.step3Title': 'Enable and share',
  'bridge.info': 'Use your own Cloudflare account. The ready-to-deploy code contains a private token: do not publish it. Telegram clients must support WEB proxies.',
  'bridge.linkTitle': 'Telegram WEB connection', 'bridge.linkLabel': 'Share this after deploying and enabling the Worker',
  'bridge.copyLink': 'Copy WEB link', 'bridge.openWeb': 'Open WEB proxy in Telegram ↗',
  'bridge.linkNote': 'Anyone with this link and a compatible client can connect. Saving settings alone does not verify the deployed Worker.',
  'qr.title': 'Connection QR code', 'qr.copy': 'Copy link', 'qr.open': 'Open in Telegram ↗',
  'qr.notReady': 'Connection link is not available yet. The public address is still being verified.',
  'links.publicEndpoint': 'PUBLIC ENDPOINT', 'links.tlsDomain': 'TLS MASKING DOMAIN',
  'links.tgLabel': 'Direct Telegram link', 'links.webLabel': 'Telegram HTTPS link',
  'links.copyTg': 'Copy direct link', 'links.copyWeb': 'Copy HTTPS link', 'links.open': 'Open in Telegram ↗',
  'links.note': 'Anyone with this link can use this proxy. Keep panel credentials private.',
  'links.detecting': 'Detecting the public connection address automatically...',
  'links.detected': 'Public address verified automatically. No PUBLIC_HOST or PUBLIC_PORT entry needed.',
  'links.tip': 'Copy not available? Click either field to select the full link, then copy it manually.',
  'guide.tag': 'STEP BY STEP', 'guide.title': 'Complete guide',
  'guide.desc': 'Everything you need to run your proxies, from the first login to daily maintenance.',
  'guide.toc': 'Guide contents',
  'tg.title': 'Join Our Telegram Channel', 'tg.desc': 'News, updates and guides from the ARAL team.',
  'footer.proxy': 'Telegram Proxy', 'footer.guide': 'Guide', 'footer.join': 'Join our Telegram channel ↗',
  'notice.copied': '{label} copied.', 'notice.copyFail': "Automatic copying is unavailable. The link is selected; press Ctrl+C or use your device's Copy command.",
  'notice.copyNoValue': 'Connection details are not loaded yet. Refresh and try again.',
  'notice.persist': 'Keep persistent deployment storage enabled to preserve settings.',
  'notice.sponsorSaved': 'Sponsor configuration saved. Telegram controls channel delivery; allow time for the promotion to update.',
  'notice.sponsorOff': 'Settings saved. Sponsorship is disabled.',
  'notice.bridgeSaved': 'WEB settings saved. Use the WEB link in a compatible Telegram client after deploying the Worker.',
  'notice.restartConfirm': 'Applying this change restarts the proxy engine. Clients may briefly reconnect. Continue?',
  'notice.created': 'Proxy "{name}" created.', 'notice.deleted': 'Proxy deleted.', 'notice.saved': 'Changes saved.',
  'notice.sponsorNeedTag': 'Enter the 32-character promotion tag from @MTProxybot before enabling sponsorship.',
  'notice.notReady': 'The panel is still starting. Try again in a moment.',
  'err.network': 'The server did not respond correctly. Try again shortly.', 'err.requestFailed': 'Request failed',
  'err.invalid_bridge': 'Enter a valid HTTPS Worker origin (no path, query or credentials).',
  'err.invalid_bridge_state': 'Invalid bridge state.', 'err.invalid_bridge_ip': 'Public endpoint must be a public IPv4 address.',
  'err.bridge_url_required': 'Enter the deployed Worker URL first.',
  'err.invalid_secret': 'A valid FakeTLS secret is required.', 'err.invalid_settings': 'Invalid settings.',
  'err.invalid_ad_tag': 'Promotion tag must contain exactly 32 hexadecimal characters.',
  'err.ad_tag_required': 'Get a promotion tag from @MTProxybot before enabling sponsorship.',
  'err.invalid_channel': 'Enter a public channel username, such as @mychannel.',
  'err.invalid_name': 'Choose a name between 1 and 64 characters.', 'err.name_taken': 'A proxy with this name already exists.',
  'err.invalid_port': 'Choose a TCP port between 1024 and 65535.',
  'err.port_taken': 'This port is already reserved by the panel or another proxy.',
  'err.port_in_use': 'This port is occupied by another service on this server.',
  'err.invalid_tls_host': 'Enter a valid masking domain, such as www.cloudflare.com.',
  'err.tls_host_taken': 'This masking domain is already used by another proxy.',
  'err.tls_host_required': 'All suggested masking domains are used; provide a unique one.',
  'err.limit_reached': 'The maximum number of proxies for this server has been reached.',
  'err.capacity_memory': 'Server memory is nearly exhausted; free resources before adding a proxy.',
  'err.capacity_disk': 'Server storage is nearly full; free space before adding a proxy.',
  'err.no_free_port': 'No free TCP port could be found for a new proxy.',
  'err.engine_start_failed': 'The proxy engine did not start; check the deployment logs.',
  'err.web_start_failed': 'WEB proxy could not start; previous settings restored.',
  'err.worker_unresolved': 'Worker hostname could not be resolved.',
  'err.not_found': 'Proxy not found.', 'err.busy': 'This proxy is applying changes; try again in a moment.',
  'err.origin_missing': 'Open and sign in through your hosting HTTPS domain first.',
  'err.persist_failed': 'Could not persist settings; try again.', 'err.invalid_request': 'Invalid request.',
  'err.already_configured': 'This deployment is already configured.', 'err.too_many_attempts': 'Too many attempts. Wait one minute.',
  'err.bad_setup_code': 'Incorrect setup code.', 'err.invalid_password': 'Choose a password between 8 and 256 characters.',
  'err.session': 'Session expired; sign in again.',
  'page.overview': 'Overview', 'page.proxies': 'Proxies', 'page.guide': 'Guide',
  'duration.now': 'just now', 'bytes.unit': 'B',
  guide: []
},
fa: {
  'brand.tagline': 'تلگرام · پنل مدیریت',
  'login.tag': 'اتاق کنترل خصوصی شما', 'login.title': 'خوش آمدید.',
  'login.desc': 'برای مدیریت پروکسی‌ها و کانال‌های اسپانسری وارد شوید.',
  'login.password': 'رمز عبور پنل', 'login.passwordPh': 'رمز عبور پنل را وارد کنید',
  'login.submit': 'ورود به داشبورد', 'login.footer': 'دسترسی خصوصی. اتصال شما متعلق به خودتان است.',
  'setup.tag': 'راه‌اندازی اولیه', 'setup.title': 'این پنل را مال خود کنید.',
  'setup.desc': 'رمز عبور مالک بسازید. کد راه‌اندازی یک‌بارمصرف را از لاگ استقرار هاستینگ کپی کنید.',
  'setup.code': 'کد راه‌اندازی یک‌بارمصرف', 'setup.codePh': 'از لاگ استقرار شما',
  'setup.password': 'انتخاب رمز عبور', 'setup.passwordPh': 'حداقل ۸ کاراکتر',
  'setup.confirm': 'تکرار رمز عبور', 'setup.submit': 'ساخت رمز مالک',
  'setup.footer': 'برای حفظ رمز و لینک‌های پروکسی، ذخیره‌سازی پایدار را فعال نگه دارید.',
  'nav.overview': 'نمای کلی', 'nav.proxies': 'پروکسی‌ها', 'nav.guide': 'راهنما', 'nav.logout': 'خروج',
  'theme.dark': 'تیره', 'theme.light': 'روشن', 'theme.toDark': 'تغییر به حالت تیره', 'theme.toLight': 'تغییر به حالت روشن',
  'overview.tag': 'آرال پروکسی / مرکز کنترل', 'overview.title': 'شبکه شما، در یک نگاه.',
  'overview.desc': 'فعالیت زنده، ترافیک و سلامت سرور برای همه پروکسی‌ها.',
  'overview.activityEyebrow': 'فعالیت زنده پروکسی', 'overview.activityTitle': 'مخاطبان و ترافیک',
  'overview.activityAction': 'مدیریت پروکسی‌ها ↗', 'overview.users': 'کاربران متصل',
  'overview.usersHelp': 'تخمینی از IPهای فعال، همه پروکسی‌ها', 'overview.connections': 'اتصال‌های فعال',
  'overview.connectionsHelp': 'چند اتصال برای هر دستگاه', 'overview.traffic': 'ترافیک کل',
  'overview.trafficSaved': 'ذخیره‌شده بین ری‌استارت‌ها', 'overview.upload': 'آپلود', 'overview.download': 'دانلود',
  'overview.updating': 'در حال به‌روزرسانی آمار...',
  'overview.updatedNote': 'هر ۱۵ ثانیه به‌روزرسانی می‌شود. کاربران از IPهای فعال تخمین زده می‌شوند؛ شبکه‌های مشترک ممکن است یک حساب شوند. ترافیک شامل اتصال مستقیم و وب است.',
  'overview.unavailable': 'آمار زنده موقتاً در دسترس نیست. مجموع ترافیک ذخیره‌شده حفظ می‌شود.',
  'overview.resourcesEyebrow': 'منابع سرور', 'overview.resourcesTitle': 'سلامت سرور',
  'overview.resourcesNote': 'سنجه‌های زنده کانتینر', 'overview.liveStatus': 'وضعیت زنده', 'overview.updated': 'به‌روزرسانی',
  'overview.refreshNote': 'هر ۱۵ ثانیه تازه‌سازی می‌شود', 'overview.refresh': 'تازه‌سازی',
  'resources.cpu': 'پردازنده', 'resources.memory': 'حافظه', 'resources.disk': 'دیسک',
  'resources.waiting': 'در انتظار', 'resources.high': 'بالا', 'resources.elevated': 'متوسط', 'resources.healthy': 'سالم', 'resources.unavailable': 'در دسترس نیست',
  'resources.cpuDetail': 'در حال اندازه‌گیری CPU تخصیص‌یافته', 'resources.memoryDetail': 'مصرف رم کانتینر', 'resources.diskDetail': 'مصرف فضای ذخیره‌سازی',
  'resources.cpuCores': 'از {n} هسته تخصیص‌یافته', 'resources.cpuUnavailable': 'سنجه‌های CPU در دسترس نیست',
  'resources.memoryUsed': '{used} مصرف‌شده؛ محدودیتی برای کانتینر گزارش نشده', 'resources.memoryLimit': '{used} / {limit}',
  'resources.memoryUnavailable': 'سنجه‌های حافظه در دسترس نیست',
  'resources.diskUsed': '{used} / {total} روی فایل‌سیستم داده', 'resources.diskDeployment': '{used} / {total} فضای استقرار (تخمینی)',
  'resources.diskUnavailable': 'سنجه‌های فایل‌سیستم در دسترس نیست',
  'status.checking': 'در حال بررسی...', 'status.online': 'آنلاین', 'status.starting': 'در حال راه‌اندازی', 'status.offline': 'متوقف',
  'status.uptime': 'کارکرد', 'status.allOnline': '{n} از {m} پروکسی آنلاین', 'status.none': 'هنوز پروکسی‌ای نیست',
  'proxies.tag': 'کنترل کامل', 'proxies.title': 'پروکسی‌های شما',
  'proxies.desc': 'ساخت، ویرایش و پایش نمونه‌های مستقل پروکسی. هر نمونه پورت، دامنه ماسک و لینک اتصال مخصوص خود را دارد.',
  'proxies.add': 'پروکسی جدید', 'proxies.empty': 'هنوز پروکسی‌ای ندارید. اولین پروکسی را بسازید تا لینک‌های اتصال برای اشتراک‌گذاری داشته باشید.',
  'proxies.createFirst': 'ساخت اولین پروکسی',
  'proxy.card.users': 'کاربر', 'proxy.card.connections': 'اتصال', 'proxy.card.traffic': 'ترافیک',
  'proxy.card.port': 'پورت موتور', 'proxy.card.domain': 'دامنه ماسک', 'proxy.card.links': 'لینک‌ها',
  'proxy.card.qr': 'QR', 'proxy.card.edit': 'ویرایش', 'proxy.card.disable': 'غیرفعال', 'proxy.card.enable': 'فعال',
  'proxy.card.default': 'پیش‌فرض', 'proxy.card.disabled': 'غیرفعال شده',
  'proxy.card.copyTg': 'کپی لینک مستقیم', 'proxy.card.copyWeb': 'کپی لینک HTTPS',
  'tabs.general': 'عمومی', 'tabs.sponsor': 'کانال اسپانسری', 'tabs.bridge': 'پل کلادفلر',
  'form.name': 'نام پروکسی', 'form.namePh': 'پروکسی اصلی', 'form.port': 'پورت موتور',
  'form.portHint': 'برای تخصیص خودکار خالی بگذارید.',
  'form.host': 'دامنه ماسک (FakeTLS)', 'form.hostHint': 'برای هر پروکسی یکتا باشد. تغییر آن، لینک‌های اتصال را تغییر می‌دهد.',
  'form.enabled': 'پروکسی فعال باشد', 'form.enabledHint': 'پروکسی غیرفعال اتصالی نمی‌پذیرد.',
  'form.saveNote': 'تغییر پورت و دامنه موتور را چند لحظه راه‌اندازی مجدد می‌کند.',
  'form.create': 'ساخت پروکسی', 'form.save': 'ذخیره تغییرات', 'form.creating': 'در حال ساخت...',
  'form.dangerText': 'حذف پروکسی، لینک‌ها و تنظیمات آن را برای همیشه پاک می‌کند. کلاینت‌ها قطع می‌شوند.',
  'form.delete': 'حذف پروکسی', 'form.deleteConfirm': 'این پروکسی برای همیشه حذف شود؟ لینک‌های اتصال آن از کار می‌افتد.',
  'sponsor.desc': 'کانالی که در تلگرام برای کاربران این پروکسی تبلیغ می‌شود را تعیین کنید.',
  'sponsor.channel': 'کانال عمومی', 'sponsor.fromBot': 'از @MTProxybot',
  'sponsor.enable': 'فعال‌سازی اسپانسری', 'sponsor.enableHint': 'این پروکسی را به حالت middle-proxy تلمت می‌برد.',
  'sponsor.saveNote': 'اعمال تغییرات ممکن است کلاینت‌های این پروکسی را موقتاً قطع کند.',
  'sponsor.save': 'ذخیره تغییرات →', 'sponsor.notEnabled': 'غیرفعال', 'sponsor.configured': 'فعال',
  'sponsor.setupTitle': 'اتصال به تلگرام',
  'sponsor.step1Title': 'ثبت پروکسی', 'sponsor.step2Title': 'انتخاب کانال', 'sponsor.step3Title': 'درج تگ تبلیغ',
  'sponsor.info': 'تلگرام ممکن است حدود یک ساعت برای به‌روزرسانی تبلیغ وقت بگذارد. برای کسانی که عضو کانال هستند نمایش داده نمی‌شود.',
  'sponsor.copyKey': 'کپی کلید ثبت ۳۲ کاراکتری',
  'sponsor.keyNote': 'برای پیام رمز ربات: از کلید خالی بدون پیشوند ee و بدون نام دامنه استفاده کنید.',
  'bridge.title': 'تنظیمات پروکسی وب', 'bridge.disabled': 'غیرفعال', 'bridge.enabled': 'فعال',
  'bridge.desc': 'تلگرام وب ← کلادفلر HTTPS ← پنل شما. کلاینت تلگرام باید از پروکسی وب پشتیبانی کند.',
  'bridge.workerNote': 'ورکر برند شما', 'bridge.workerHint': 'به‌صورت خودکار در فایل دانلودی ساخته می‌شود. تنظیمات اسپانسری در اختیار خودتان است.',
  'bridge.origin': 'مبانی هاستینگ شما (خودکار شناسایی می‌شود)',
  'bridge.originNote': 'ورکر کپی‌شده از قبل برای این پنل تنظیم شده است. نیازی به متغیر یا توکن کلادفلر نیست.',
  'bridge.workerUrl': 'آدرس ورکر مستقرشده در کلادفلر', 'bridge.ipOverride': 'پیشرفته: بازنویسی IPv4 نقطه اتصال',
  'bridge.ipLabel': 'IPv4 عمومی نقطه اتصال', 'bridge.ipHint': 'در حالت فعال خودکار حل می‌شود. معمولاً خالی بگذارید.',
  'bridge.enable': 'فعال‌سازی پروکسی وب بومی', 'bridge.saveNote': 'اعمال تغییرات این پروکسی را ری‌استارت می‌کند؛ کلاینت‌ها موقتاً وصل می‌شوند.',
  'bridge.save': 'ذخیره تنظیمات پل', 'bridge.copyWorker': 'کپی ورکر آماده استقرار',
  'bridge.downloadWorker': 'دانلود ورکر آماده استقرار', 'bridge.viewWorker': 'مشاهده کد ورکر / کپی دستی',
  'bridge.loadWorker': 'بارگذاری کد', 'bridge.manualToken': 'پیشرفته: توکن دستی پل',
  'bridge.tokenLabel': 'توکن خصوصی پل', 'bridge.copyToken': 'کپی توکن پل',
  'bridge.tokenNote': 'فقط برای پیشرفته: ورکر آماده همین توکن را دارد. کد کپی‌شده را خصوصی نگه دارید.',
  'bridge.bundle': 'بسته اختیاری دسکتاپ / Wrangler', 'bridge.downloadBundle': 'دانلود بسته خصوصی ورکر',
  'bridge.phoneEyebrow': 'راه‌اندازی با موبایل', 'bridge.phoneTitle': 'کپی، چسباندن، استقرار',
  'bridge.step1Title': 'ساخت ورکر کلادفلر', 'bridge.step2Title': 'چسباندن کد مستقل', 'bridge.step3Title': 'فعال‌سازی و اشتراک',
  'bridge.info': 'از حساب کلادفلر خودتان استفاده کنید. کد آماده شامل توکن خصوصی است: منتشرش نکنید. کلاینت تلگرام باید از پروکسی وب پشتیبانی کند.',
  'bridge.linkTitle': 'اتصال وب تلگرام', 'bridge.linkLabel': 'پس از استقرار و فعال‌سازی ورکر این را به اشتراک بگذارید',
  'bridge.copyLink': 'کپی لینک وب', 'bridge.openWeb': 'باز کردن پروکسی وب در تلگرام ↗',
  'bridge.linkNote': 'هرکس این لینک را داشته باشد و کلاینت سازگار داشته باشد وصل می‌شود. ذخیره تنظیمات به‌تنهایی ورکر را تأیید نمی‌کند.',
  'qr.title': 'کد QR اتصال', 'qr.copy': 'کپی لینک', 'qr.open': 'باز کردن در تلگرام ↗',
  'qr.notReady': 'لینک اتصال هنوز آماده نیست. آدرس عمومی در حال تأیید است.',
  'links.publicEndpoint': 'نقطه اتصال عمومی', 'links.tlsDomain': 'دامنه ماسک TLS',
  'links.tgLabel': 'لینک مستقیم تلگرام', 'links.webLabel': 'لینک HTTPS تلگرام',
  'links.copyTg': 'کپی لینک مستقیم', 'links.copyWeb': 'کپی لینک HTTPS', 'links.open': 'باز کردن در تلگرام ↗',
  'links.note': 'هرکس این لینک را داشته باشد می‌تواند از این پروکسی استفاده کند. رمز پنل را خصوصی نگه دارید.',
  'links.detecting': 'در حال شناسایی خودکار آدرس عمومی اتصال...',
  'links.detected': 'آدرس عمومی به‌صورت خودکار تأیید شد. نیازی به وارد کردن PUBLIC_HOST یا PUBLIC_PORT نیست.',
  'links.tip': 'کپی کار نمی‌کند؟ روی هر فیلد کلیک کنید تا لینک کامل انتخاب شود، سپس دستی کپی کنید.',
  'guide.tag': 'گام‌به‌گام', 'guide.title': 'راهنمای کامل',
  'guide.desc': 'هر آنچه برای اداره پروکسی‌ها لازم دارید؛ از اولین ورود تا نگهداری روزانه.',
  'guide.toc': 'فهرست راهنما',
  'tg.title': 'پیوستن به کانال تلگرام ما', 'tg.desc': 'اخبار، به‌روزرسانی‌ها و راهنماها از تیم آرال.',
  'footer.proxy': 'پروکسی تلگرام', 'footer.guide': 'راهنما', 'footer.join': 'پیوستن به کانال تلگرام ما ↗',
  'notice.copied': '{label} کپی شد.', 'notice.copyFail': 'کپی خودکار در دسترس نیست. لینک انتخاب شده؛ Ctrl+C بزنید یا از دستور کپی دستگاه استفاده کنید.',
  'notice.copyNoValue': 'جزئیات اتصال هنوز بارگذاری نشده. تازه‌سازی کنید و دوباره تلاش کنید.',
  'notice.persist': 'ذخیره‌سازی پایدار استقرار را فعال نگه دارید تا تنظیمات حفظ شود.',
  'notice.sponsorSaved': 'تنظیمات اسپانسری ذخیره شد. تلگرام ارسال کانال را کنترل می‌کند؛ برای به‌روزرسانی تبلیغ زمان بدهید.',
  'notice.sponsorOff': 'تنظیمات ذخیره شد. اسپانسری غیرفعال است.',
  'notice.bridgeSaved': 'تنظیمات وب ذخیره شد. پس از استقرار ورکر، از لینک وب در کلاینت سازگار استفاده کنید.',
  'notice.restartConfirm': 'این تغییر موتور پروکسی را ری‌استارت می‌کند. کلاینت‌ها ممکن است موقتاً قطع شوند. ادامه می‌دهید؟',
  'notice.created': 'پروکسی «{name}» ساخته شد.', 'notice.deleted': 'پروکسی حذف شد.', 'notice.saved': 'تغییرات ذخیره شد.',
  'notice.sponsorNeedTag': 'پیش از فعال‌سازی اسپانسری، تگ ۳۲ کاراکتری را از @MTProxybot وارد کنید.',
  'notice.notReady': 'پنل هنوز در حال راه‌اندازی است. چند لحظه بعد تلاش کنید.',
  'err.network': 'پاسخ سرور درست نبود. کمی بعد دوباره تلاش کنید.', 'err.requestFailed': 'درخواست ناموفق بود',
  'err.invalid_bridge': 'یک مبنا HTTPS ورکر معتبر وارد کنید (بدون مسیر، کوئری یا اعتبارنامه).',
  'err.invalid_bridge_state': 'وضعیت پل نامعتبر است.', 'err.invalid_bridge_ip': 'نقطه اتصال عمومی باید یک IPv4 عمومی باشد.',
  'err.bridge_url_required': 'ابتدا آدرس ورکر مستقرشده را وارد کنید.',
  'err.invalid_secret': 'رمز FakeTLS معتبر لازم است.', 'err.invalid_settings': 'تنظیمات نامعتبر است.',
  'err.invalid_ad_tag': 'تگ تبلیغ باید دقیقاً ۳۲ کاراکتر هگز باشد.',
  'err.ad_tag_required': 'پیش از فعال‌سازی اسپانسری، از @MTProxybot تگ تبلیغ بگیرید.',
  'err.invalid_channel': 'نام کاربری کانال عمومی وارد کنید، مانند @mychannel.',
  'err.invalid_name': 'نامی بین ۱ تا ۶۴ کاراکتر انتخاب کنید.', 'err.name_taken': 'پروکسی‌ای با این نام وجود دارد.',
  'err.invalid_port': 'پورتی بین ۱۰۲۴ تا ۶۵۵۳۵ انتخاب کنید.',
  'err.port_taken': 'این پورت قبلاً برای پنل یا پروکسی دیگری رزرو شده است.',
  'err.port_in_use': 'این پورت روی سرور توسط سرویس دیگری اشغال شده است.',
  'err.invalid_tls_host': 'دامنه ماسک معتبر وارد کنید، مانند www.cloudflare.com.',
  'err.tls_host_taken': 'این دامنه ماسک قبلاً توسط پروکسی دیگری استفاده شده است.',
  'err.tls_host_required': 'همه دامنه‌های پیشنهادی استفاده شده‌اند؛ یک دامنه یکتا وارد کنید.',
  'err.limit_reached': 'به سقف تعداد پروکسی این سرور رسیده‌اید.',
  'err.capacity_memory': 'حافظه سرور تقریباً پر است؛ پیش از افزودن پروکسی منابع را آزاد کنید.',
  'err.capacity_disk': 'فضای ذخیره‌سازی تقریباً پر است؛ پیش از افزودن پروکسی فضا آزاد کنید.',
  'err.no_free_port': 'پورت TCP آزادی برای پروکسی جدید پیدا نشد.',
  'err.engine_start_failed': 'موتور پروکسی راه‌اندازی نشد؛ لاگ استقرار را بررسی کنید.',
  'err.web_start_failed': 'پروکسی وب راه‌اندازی نشد؛ تنظیمات قبلی بازگردانده شد.',
  'err.worker_unresolved': 'نام میزبان ورکر حل نشد.',
  'err.not_found': 'پروکسی پیدا نشد.', 'err.busy': 'این پروکسی در حال اعمال تغییرات است؛ چند لحظه بعد تلاش کنید.',
  'err.origin_missing': 'ابتدا از طریق دامنه HTTPS هاستینگ وارد پنل شوید.',
  'err.persist_failed': 'ذخیره تنظیمات ممکن نشد؛ دوباره تلاش کنید.', 'err.invalid_request': 'درخواست نامعتبر.',
  'err.already_configured': 'این استقرار قبلاً پیکربندی شده است.', 'err.too_many_attempts': 'تلاش‌های زیاد. یک دقیقه صبر کنید.',
  'err.bad_setup_code': 'کد راه‌اندازی نادرست است.', 'err.invalid_password': 'رمزی بین ۸ تا ۲۵۶ کاراکتر انتخاب کنید.',
  'err.session': 'نشست منقضی شد؛ دوباره وارد شوید.',
  'page.overview': 'نمای کلی', 'page.proxies': 'پروکسی‌ها', 'page.guide': 'راهنما',
  'duration.now': 'همین حالا', 'bytes.unit': 'بایت',
  guide: []
}};

/* Guide content — matches the real app behavior (sections: intro, login, proxies, ports, links, services, troubleshooting, security). */
I18N.en.guide = [
  ['intro', 'Introduction & features', `
  <p><strong>ARAL Proxy</strong> is a private control panel for running <strong>MTProto (FakeTLS) proxies for Telegram</strong> on Bot-Hosting. It manages the Telemt engine for you and needs no Docker, root access or extra packages.</p>
  <ul>
    <li><strong>Multiple independent proxies</strong> — each with its own name, engine port, masking domain and links.</li>
    <li><strong>Sponsored channel</strong> per proxy via @MTProxybot.</li>
    <li><strong>Cloudflare WEB bridge</strong> for native Telegram WEB proxy links.</li>
    <li><strong>Live statistics</strong> — users, connections, traffic, CPU, memory and disk.</li>
    <li><strong>Dark & light themes</strong> and a <strong>Persian/English</strong> interface; both choices are remembered.</li>
    <li><strong>Fully responsive</strong> design for mobile, tablet and desktop.</li>
  </ul>`],
  ['login', 'Login & first-time setup', `
  <ol>
    <li>Open your deployment's HTTPS address. On the very first visit the panel asks for a <strong>one-time setup code</strong> — copy it from the hosting deployment logs (it is printed once at boot).</li>
    <li>Choose an owner password of <strong>at least 8 characters</strong>. It is stored only as a salted PBKDF2 hash.</li>
    <li>Sign in with this password afterwards. Sessions last 8 hours and survive re-entry.</li>
    <li>If you redeploy with persistent storage disabled, the password and all proxy data are reset.</li>
  </ol>
  <div class="guide-note">The setup code only exists until the owner password is created. Keep the deployment logs private.</div>`],
  ['proxies', 'Creating & managing proxies', `
  <p>Open <strong>Proxies → New proxy</strong>. Each proxy is a real, separate Telemt engine process with its own settings.</p>
  <ol>
    <li><strong>Name</strong> — any label up to 64 characters; must be unique.</li>
    <li><strong>Engine port</strong> — leave empty for automatic allocation, or pick a free port between 1024 and 65535. The panel rejects ports already used by the panel, another proxy or another service.</li>
    <li><strong>Masking domain</strong> — the FakeTLS domain inside the connection secret. It must be unique per proxy (the first proxy defaults to <code>www.cloudflare.com</code>, further ones get suggestions). This domain is what lets the panel route each connection to the right engine on the shared public port.</li>
  </ol>
  <p>Each card shows live users, connections and traffic, plus buttons to <strong>copy links, show a QR code, edit, enable/disable and delete</strong>. Disabling stops the engine but keeps its settings and links valid for later.</p>
  <div class="guide-note">Bot-Hosting exposes one public TCP port. All proxies share it; Telegram tells them apart by each proxy's masking domain and secret — exactly how the panel routes connections internally.</div>`],
  ['ports', 'Ports & connection settings', `
  <ul>
    <li><strong>Public port</strong> — assigned by the hosting platform (SERVER_PORT). It carries both the panel and all proxy traffic and is detected automatically.</li>
    <li><strong>Engine ports</strong> — internal listeners (default 3128 and up), unique per proxy, changeable from the proxy's Edit dialog.</li>
    <li><strong>Metric/API/WEB ports</strong> — internal loopback ports for statistics and the WEB bridge; allocated automatically, never exposed publicly.</li>
  </ul>
  <p>Duplicate, privileged (below 1024) or occupied ports are rejected with a clear error before anything is created. Before every creation the panel also checks the server's memory and disk headroom.</p>`],
  ['links', 'Getting & using connection info', `
  <p>Every proxy card exposes its links once the public address is verified (usually seconds after boot; the status pill on Overview shows progress):</p>
  <ul>
    <li><strong>Direct Telegram link</strong> — <code>tg://proxy?...</code>; opens Telegram directly on the device.</li>
    <li><strong>HTTPS link</strong> — <code>https://t.me/proxy?...</code>; shareable anywhere and works like a normal web link.</li>
    <li><strong>QR code</strong> — opens from the QR button; scan it with a phone to connect without typing anything.</li>
  </ul>
  <p>Links never change when you rename a proxy or restart the server. They only change if you edit the proxy's masking domain.</p>`],
  ['services', 'Managing services (sponsorship & bridge)', `
  <p><strong>Sponsored channel</strong> (per proxy, in Edit → Sponsored channel): register the proxy at <a href="https://t.me/MTProxybot" target="_blank" rel="noopener noreferrer">@MTProxybot</a>, set a promotion channel, then paste the 32-character promotion tag here and enable sponsorship. The registration key can be copied from the same tab.</p>
  <p><strong>Cloudflare bridge</strong> (per proxy, in Edit → Cloudflare bridge): copy the ready-to-deploy Worker, paste it into a Cloudflare Worker, deploy, paste the workers.dev URL back and enable. This produces a <code>tg://webproxy</code> link that connects through Cloudflare HTTPS — useful when direct MTProto is throttled.</p>`],
  ['troubleshooting', 'Troubleshooting common errors', `
  <ul>
    <li><strong>"This port is already reserved / occupied"</strong> — pick another engine port; ports below 1024, the panel port and other proxies' ports are not allowed.</li>
    <li><strong>"This masking domain is already used"</strong> — each proxy needs a unique FakeTLS domain; enter a different one.</li>
    <li><strong>"Proxy engine did not start"</strong> — check the hosting logs; the most common causes are an occupied internal port or a corrupted redeploy. The proxy keeps its previous settings.</li>
    <li><strong>Links show "Detecting public address..."</strong> — the panel verifies its public endpoint by probing itself; on some networks this takes a minute or two. It retries automatically.</li>
    <li><strong>Live statistics show "—"</strong> — the engine's metrics are momentarily unreachable (for example right after a restart). Values return on the next refresh.</li>
    <li><strong>QR does not scan</strong> — increase screen brightness or use the Copy buttons instead; the link text is identical.</li>
    <li><strong>Signed out unexpectedly</strong> — sessions last 8 hours; simply sign in again.</li>
  </ul>`],
  ['security', 'Security & server maintenance', `
  <ul>
    <li>Use a long, unique owner password; the panel rate-limits failed logins and hashes the password with PBKDF2.</li>
    <li>Session cookies are <code>HttpOnly</code>, <code>SameSite=Strict</code> and marked <code>Secure</code> on HTTPS domains; all state-changing requests require a CSRF token.</li>
    <li>Secrets (proxy keys, bridge tokens, engine configs) are stored with owner-only file permissions (0600) and never logged.</li>
    <li>Keep <strong>persistent storage</strong> enabled, or every restart regenerates secrets and all old links stop working.</li>
    <li>The pinned Telemt engine is downloaded once with SHA-256 verification and cached; bandwidth stays low afterwards.</li>
    <li>Check Overview → Server health occasionally; sustained CPU above 90% or a nearly-full disk affects every proxy on the box.</li>
    <li>Deployment updates: upload the new ZIP over the same deployment and keep the same persistent storage — settings and links carry over automatically.</li>
  </ul>`]
];
I18N.fa.guide = [
  ['intro', 'معرفی و امکانات', `
  <p><strong>آرال پروکسی</strong> یک پنل مدیریت خصوصی برای اجرای <strong>پروکسی‌های MTProto (FakeTLS) تلگرام</strong> روی بات-هاستینگ است. موتور Telemt را برای شما مدیریت می‌کند و به داکر، دسترسی روت یا نصب افزوده اضافه‌ای نیاز ندارد.</p>
  <ul>
    <li><strong>چند پروکسی مستقل</strong> — هر کدام با نام، پورت موتور، دامنه ماسک و لینک‌های مخصوص خود.</li>
    <li><strong>کانال اسپانسری</strong> برای هر پروکسی از طریق @MTProxybot.</li>
    <li><strong>پل کلادفلر (وب)</strong> برای لینک‌های بومی پروکسی وب تلگرام.</li>
    <li><strong>آمار زنده</strong> — کاربران، اتصال‌ها، ترافیک، CPU، حافظه و دیسک.</li>
    <li><strong>حالت تیره و روشن</strong> و رابط <strong>فارسی/انگلیسی</strong>؛ هر دو انتخاب به خاطر سپرده می‌شوند.</li>
    <li>طراحی <strong>کاملاً واکنش‌گرا</strong> برای موبایل، تبلت و دسکتاپ.</li>
  </ul>`],
  ['login', 'ورود و تنظیمات اولیه', `
  <ol>
    <li>آدرس HTTPS استقرار خود را باز کنید. در اولین بازدید، پنل <strong>کد راه‌اندازی یک‌بارمصرف</strong> می‌خواهد — آن را از لاگ استقرار هاستینگ کپی کنید (فقط یک بار هنگام بوت چاپ می‌شود).</li>
    <li>رمز مالک با <strong>حداقل ۸ کاراکتر</strong> انتخاب کنید. فقط به‌صورت هش PBKDF2 نمکی ذخیره می‌شود.</li>
    <li>پس از آن با همین رمز وارد شوید. نشست‌ها ۸ ساعت اعتبار دارند.</li>
    <li>اگر با ذخیره‌سازی غیرپایدار مجدد مستقر کنید، رمز و همه داده‌های پروکسی ریست می‌شود.</li>
  </ol>
  <div class="guide-note">کد راه‌اندازی فقط تا ساخته‌شدن رمز مالک معتبر است. لاگ استقرار را خصوصی نگه دارید.</div>`],
  ['proxies', 'ساخت و مدیریت پروکسی', `
  <p><strong>پروکسی‌ها ← پروکسی جدید</strong> را باز کنید. هر پروکسی یک فرایند واقعی و مستقل موتور Telemt با تنظیمات خودش است.</p>
  <ol>
    <li><strong>نام</strong> — برچسب دلخواه تا ۶۴ کاراکتر؛ باید یکتا باشد.</li>
    <li><strong>پورت موتور</strong> — برای تخصیص خودکار خالی بگذارید یا پورتی آزاد بین ۱۰۲۴ تا ۶۵۵۳۵ انتخاب کنید. پنل پورت‌های اشغالی پنل، پروکسی‌های دیگر یا سرویس‌های دیگر را رد می‌کند.</li>
    <li><strong>دامنه ماسک</strong> — دامنه FakeTLS داخل رمز اتصال. برای هر پروکسی باید یکتا باشد (پروکسی اول به‌صورت پیش‌فرض <code>www.cloudflare.com</code> و موارد بعدی پیشنهاد می‌گیرند). همین دامنه است که به پنل اجازه می‌دهد روی پورت عمومی مشترک، هر اتصال را به موتور درست برساند.</li>
  </ol>
  <p>هر کارت کاربران، اتصال‌ها و ترافیک زنده را نشان می‌دهد و دکمه‌های <strong>کپی لینک، نمایش QR، ویرایش، فعال/غیرفعال و حذف</strong> دارد. غیرفعال‌سازی موتور را متوقف می‌کند اما تنظیمات و لینک‌ها برای آینده حفظ می‌شوند.</p>
  <div class="guide-note">بات-هاستینگ فقط یک پورت TCP عمومی می‌دهد. همه پروکسی‌ها آن را به اشتراک می‌گذارند؛ تلگرام آن‌ها را با دامنه ماسک و رمز هر پروکسی از هم تشخیص می‌دهد — دقیقاً همان‌طور که پنل داخلاً مسیریابی می‌کند.</div>`],
  ['ports', 'پورت‌ها و تنظیمات اتصال', `
  <ul>
    <li><strong>پورت عمومی</strong> — توسط پلتفرم هاستینگ تعیین می‌شود (SERVER_PORT). هم ترافیک پنل و هم همه پروکسی‌ها را حمل می‌کند و خودکار شناسایی می‌شود.</li>
    <li><strong>پورت‌های موتور</strong> — شنونده‌های داخلی (پیش‌فرض ۳۱۲۸ به بالا)، برای هر پروکسی یکتا، و از پنجره ویرایش همان پروکسی قابل تغییر.</li>
    <li><strong>پورت‌های سنجه/API/وب</strong> — پورت‌های داخلی loopback برای آمار و پل وب؛ خودکار تخصیص می‌یابند و هرگز عمومی نمی‌شوند.</li>
  </ul>
  <p>پورت تکراری، پورت‌های محافظت‌شده (زیر ۱۰۲۴) و پورت اشغالی پیش از ساختن چیزی با خطای واضح رد می‌شوند. پیش از هر ساخت، پنل حاشیه امنیت حافظه و دیسک سرور را هم بررسی می‌کند.</p>`],
  ['links', 'دریافت و استفاده از اطلاعات اتصال', `
  <p>وقتی آدرس عمومی تأیید شد (معمولاً چند ثانیه بعد از بوت؛ وضعیت در نمای کلی دیده می‌شود) هر کارت پروکسی لینک‌هایش را می‌دهد:</p>
  <ul>
    <li><strong>لینک مستقیم تلگرام</strong> — <code>tg://proxy?...</code>؛ تلگرام را مستقیم روی دستگاه باز می‌کند.</li>
    <li><strong>لینک HTTPS</strong> — <code>https://t.me/proxy?...</code>؛ همه‌جا قابل اشتراک و مانند یک لینک وب معمولی.</li>
    <li><strong>کد QR</strong> — از دکمه QR باز می‌شود؛ با موبایل اسکن کنید تا بدون تایپ وصل شوید.</li>
  </ul>
  <p>لینک‌ها با تغییر نام پروکسی یا ری‌استارت سرور عوض نمی‌شوند. فقط با ویرایش دامنه ماسک تغییر می‌کنند.</p>`],
  ['services', 'مدیریت سرویس‌ها (اسپانسری و پل)', `
  <p><strong>کانال اسپانسری</strong> (برای هر پروکسی، در ویرایش ← کانال اسپانسری): پروکسی را در <a href="https://t.me/MTProxybot" target="_blank" rel="noopener noreferrer">@MTProxybot</a> ثبت کنید، کانال تبلیغ را تعیین کنید، سپس تگ ۳۲ کاراکتری را اینجا وارد و اسپانسری را فعال کنید. کلید ثبت هم در همین بخش قابل کپی است.</p>
  <p><strong>پل کلادفلر</strong> (برای هر پروکسی، در ویرایش ← پل کلادفلر): ورکر آماده را کپی کنید، در یک Worker کلادفلر بچسبانید، مستقر کنید، آدرس workers.dev را برگردانید و فعال کنید. این کار لینک <code>tg://webproxy</code> می‌سازد که از HTTPS کلادفلر وصل می‌شود — وقتی MTProto مستقیم کند است کاربردی است.</p>`],
  ['troubleshooting', 'عیب‌یابی خطاهای رایج', `
  <ul>
    <li><strong>«این پورت قبلاً رزرو/اشغال شده»</strong> — پورت موتور دیگری انتخاب کنید؛ پورت‌های زیر ۱۰۲۴، پورت پنل و پورت پروکسی‌های دیگر مجاز نیست.</li>
    <li><strong>«این دامنه ماسک قبلاً استفاده شده»</strong> — هر پروکسی به دامنه FakeTLS یکتا نیاز دارد؛ دامنه دیگری وارد کنید.</li>
    <li><strong>«موتور پروکسی راه‌اندازی نشد»</strong> — لاگ هاستینگ را ببینید؛ رایج‌ترین دلیل اشغال بودن پورت داخلی یا استقرار خراب است. پروکسی تنظیمات قبلی را نگه می‌دارد.</li>
    <li><strong>لینک‌ها «در حال شناسایی آدرس عمومی»</strong> — پنل نقطه اتصال عمومی را با پروب خودش تأیید می‌کند؛ روی بعضی شبکه‌ها چند دقیقه طول می‌کشد و خودکار تلاش می‌شود.</li>
    <li><strong>آمار زنده «—»</strong> — سنجه‌های موتور موقتاً در دسترس نیست (مثلاً بعد از ری‌استارت). در تازه‌سازی بعدی برمی‌گردد.</li>
    <li><strong>QR خوانده نمی‌شود</strong> — نور صفحه را بیشتر کنید یا از دکمه‌های کپی استفاده کنید؛ متن لینک همان است.</li>
    <li><strong>خارج شدید</strong> — نشست‌ها ۸ ساعت اعتبار دارند؛ دوباره وارد شوید.</li>
  </ul>`],
  ['security', 'امنیت و نگهداری سرور', `
  <ul>
    <li>رمز مالک بلند و یکتا انتخاب کنید؛ پنل ورودهای ناموفق را محدود و رمز را با PBKDF2 هش می‌کند.</li>
    <li>کوکی نشست‌ها <code>HttpOnly</code> و <code>SameSite=Strict</code> است و روی دامنه‌های HTTPS علامت <code>Secure</code> می‌خورد؛ همه درخواست‌های تغییردهنده توکن CSRF می‌خواهند.</li>
    <li>رمزها (کلیدهای پروکسی، توکن پل، پیکربندی موتور) با مجوز فایل فقط-مالک (۰۶۰۰) ذخیره و هرگز لاگ نمی‌شوند.</li>
    <li><strong>ذخیره‌سازی پایدار</strong> را فعال نگه دارید، وگرنه هر ری‌استارت رمزها را نو می‌سازد و لینک‌های قبلی از کار می‌افتد.</li>
    <li>موتور Telemt نسخه‌ثابت یک بار با تأیید SHA-256 دانلود و کش می‌شود؛ بعدش مصرف باند پایین می‌ماند.</li>
    <li>گاهی نمای کلی ← سلامت سرور را ببینید؛ CPU بالای ۹۰٪ یا دیسک پر روی همه پروکسی‌ها اثر می‌گذارد.</li>
    <li>به‌روزرسانی استقرار: ZIP جدید را روی همان استقرار بگذارید و همان ذخیره‌سازی پایدار را نگه دارید — تنظیمات و لینک‌ها خودکار منتقل می‌شوند.</li>
  </ul>`]
];

let lang = 'en';
try { lang = localStorage.getItem('aral-lang') || ((navigator.language || '').toLowerCase().startsWith('fa') ? 'fa' : 'en'); } catch {}
if (!I18N[lang]) lang = 'en';
const t = (key, vars) => {
  let text = (I18N[lang] && I18N[lang][key]) || I18N.en[key] || key;
  if (vars) for (const [k, v] of Object.entries(vars)) text = text.split('{' + k + '}').join(v);
  return text;
};
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));

/* ================= theme & language ================= */
const THEME_ASSETS = {
  dark: {logo: '/panel/assets/dark-logo.png', background: '/panel/assets/dark-background.png', color: '#0b0e17'},
  light: {logo: '/panel/assets/light-logo.png', background: '/panel/assets/light-background.png', color: '#e9edf4'}
};
function applyTheme(theme, persist = true) {
  theme = theme === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.theme = theme;
  document.body.dataset.theme = theme;
  const assets = THEME_ASSETS[theme];
  for (const img of document.querySelectorAll('[data-theme-src]')) {
    const kind = img.dataset.themeSrc;
    if (assets[kind]) img.src = assets[kind];
  }
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = assets.color;
  const label = $('theme-label'), icon = $('theme-icon');
  if (label) label.textContent = t(theme === 'dark' ? 'theme.dark' : 'theme.light');
  if (icon) icon.textContent = theme === 'dark' ? '\u263E' : '\u2600';
  if ($('theme-toggle')) $('theme-toggle').setAttribute('aria-label', t(theme === 'dark' ? 'theme.toLight' : 'theme.toDark'));
  if (persist) { try { localStorage.setItem('aral-theme', theme); } catch {} }
}
function applyLanguage(next, persist = true) {
  lang = I18N[next] ? next : 'en';
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === 'fa' ? 'rtl' : 'ltr';
  for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of document.querySelectorAll('[data-i18n-ph]')) el.placeholder = t(el.dataset.i18nPh);
  for (const el of document.querySelectorAll('[data-i18n-html]')) el.innerHTML = t(el.dataset.i18nHtml);
  $('lang-fa').classList.toggle('active', lang === 'fa');
  $('lang-en').classList.toggle('active', lang === 'en');
  renderGuide();
  if (statusData) { renderOverview(); renderProxies(); }
  renderRoute(false);
  if (persist) { try { localStorage.setItem('aral-lang', lang); } catch {} }
}

/* ================= helpers ================= */
function currentPage() {
  return routeAliases[location.hash.replace(/^#\/?/, '').split('?')[0]] || 'overview';
}
function renderRoute(focus = true) {
  const page = currentPage();
  for (const view of document.querySelectorAll('[data-view]')) {
    const active = view.dataset.view === page;
    view.hidden = !active;
    view.classList.toggle('active', active);
  }
  for (const link of document.querySelectorAll('[data-page]')) {
    const active = link.dataset.page === page;
    link.classList.toggle('active', active);
    if (active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  document.title = t('page.' + page) + ' | ARAL Proxy';
  if (focus && statusData) {
    const heading = $(page + '-heading');
    if (heading) heading.focus({preventScroll: true});
    window.scrollTo({top: 0, behavior: 'instant'});
  }
}
async function api(path, data, method) {
  const response = await fetch(path, {
    method: method || (data ? 'POST' : 'GET'), credentials: 'same-origin',
    headers: data ? {'Content-Type': 'application/json', 'X-CSRF-Token': statusData?.csrf || ''} : {},
    body: data ? JSON.stringify(data) : undefined
  });
  let result;
  try { result = await response.json(); }
  catch { throw {message: t('err.network'), code: 'network'}; }
  if (!response.ok) {
    if (response.status === 401 && !path.startsWith('/api/login')) showLogin();
    throw {message: result.error || t('err.requestFailed'), code: result.code || null};
  }
  return result;
}
function showLogin() {
  $('dashboard').hidden = true;
  $('login-view').hidden = false;
  $('setup-view').hidden = true;
  statusData = null;
  $('notice').hidden = true;
  clearInterval(refreshTimer);
}
function notice(message, bad = false) {
  clearTimeout(noticeTimer);
  const el = $('notice');
  el.textContent = message;
  el.classList.toggle('bad', bad);
  el.setAttribute('role', bad ? 'alert' : 'status');
  el.hidden = false;
  noticeTimer = setTimeout(() => { el.hidden = true; }, bad ? 8000 : 3000);
}
function showError(error) {
  const code = error && error.code ? t('err.' + error.code) : null;
  notice(code && error.code ? code : (error?.message || t('err.requestFailed')), true);
}
function duration(seconds) {
  if (seconds < 60) return seconds + 's';
  if (seconds < 3600) return Math.floor(seconds / 60) + 'm';
  return Math.floor(seconds / 3600) + 'h ' + Math.floor(seconds % 3600 / 60) + 'm';
}
function bytes(value) {
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'];
  let index = 0;
  let v = value;
  while (v >= 1024 && index < units.length - 1) { v /= 1024; index++; }
  return v.toLocaleString(lang === 'fa' ? 'fa-IR' : undefined, {maximumFractionDigits: index ? 2 : 0}) + ' ' + units[index];
}
async function copy(value, label, input) {
  if (!value) { notice(t('notice.copyNoValue'), true); return; }
  try {
    await navigator.clipboard.writeText(value);
    notice(t('notice.copied', {label}));
  } catch {
    if (input) { const details = input.closest('details'); if (details) details.open = true; input.focus(); input.select(); }
    notice(t('notice.copyFail'), true);
  }
}

/* ================= overview ================= */
function renderResources(resource = {}) {
  for (const name of ['cpu', 'memory', 'disk']) {
    const percent = resource[name + '_percent'];
    const available = Number.isFinite(percent);
    const level = available ? Math.max(0, Math.min(100, percent)) : 0;
    $(name + '-value').textContent = available ? percent.toFixed(1) + '%' : '\u2014';
    $(name + '-state').textContent = available ? (percent >= 90 ? t('resources.high') : percent >= 70 ? t('resources.elevated') : t('resources.healthy')) : t('resources.unavailable');
    $(name + '-state').dataset.level = available ? (percent >= 90 ? 'high' : percent >= 70 ? 'medium' : 'normal') : 'unknown';
    $(name + '-bar').style.width = level + '%';
    $(name + '-meter').setAttribute('aria-valuenow', String(level));
    $(name + '-meter').setAttribute('aria-valuetext', available ? percent.toFixed(1) : '0');
  }
  $('cpu-detail').textContent = Number.isFinite(resource.cpu_cores) ? t('resources.cpuCores', {n: resource.cpu_cores.toLocaleString(lang === 'fa' ? 'fa-IR' : undefined, {maximumFractionDigits: 2})}) : t('resources.cpuUnavailable');
  if (Number.isFinite(resource.memory_used)) {
    $('memory-detail').textContent = resource.memory_limit ? t('resources.memoryLimit', {used: bytes(resource.memory_used), limit: bytes(resource.memory_limit)}) : t('resources.memoryUsed', {used: bytes(resource.memory_used)});
  } else $('memory-detail').textContent = t('resources.memoryUnavailable');
  if (Number.isFinite(resource.disk_used)) {
    $('disk-detail').textContent = t(resource.disk_scope === 'deployment' ? 'resources.diskDeployment' : 'resources.diskUsed', {used: bytes(resource.disk_used), total: bytes(resource.disk_total)});
  } else $('disk-detail').textContent = t('resources.diskUnavailable');
}
function renderOverview() {
  const s = statusData;
  const proxies = s.proxies || [];
  const enabledProxies = proxies.filter(p => p.enabled);
  const runningCount = enabledProxies.filter(p => p.running).length;
  const anyRunning = runningCount > 0;
  $('running').textContent = !proxies.length ? t('status.none') : anyRunning ? t('status.online') : t('status.starting');
  $('running-dot').classList.toggle('offline', !anyRunning);
  $('engine').textContent = s.server.engine;
  $('proxy-count').textContent = proxies.length ? t('status.allOnline', {n: runningCount, m: enabledProxies.length}) : t('status.none');
  const uptimes = proxies.filter(p => p.running && p.uptime);
  $('uptime').textContent = uptimes.length ? duration(Math.max(...uptimes.map(p => p.uptime))) : '\u2014';
  renderResources(s.server.resources);
  const usage = {available: proxies.some(p => p.usage?.available), users: 0, connections: 0,
    upload_bytes: 0, download_bytes: 0, total_bytes: 0, since: null};
  for (const p of proxies) {
    usage.users += p.usage?.users || 0;
    usage.connections += p.usage?.connections || 0;
    usage.upload_bytes += p.usage?.upload_bytes || 0;
    usage.download_bytes += p.usage?.download_bytes || 0;
    usage.total_bytes += p.usage?.total_bytes || 0;
    if (p.usage?.since && (usage.since === null || p.usage.since < usage.since)) usage.since = p.usage.since;
  }
  $('connected-users').textContent = usage.available ? usage.users.toLocaleString(lang === 'fa' ? 'fa-IR' : undefined) : '\u2014';
  $('active-connections').textContent = usage.available ? usage.connections.toLocaleString(lang === 'fa' ? 'fa-IR' : undefined) : '\u2014';
  $('total-usage').textContent = bytes(usage.total_bytes);
  $('upload-usage').textContent = bytes(usage.upload_bytes);
  $('download-usage').textContent = bytes(usage.download_bytes);
  $('usage-period').textContent = usage.since ? t('overview.trafficSaved') + ' · ' + new Date(usage.since * 1000).toLocaleDateString(lang === 'fa' ? 'fa-IR' : undefined) : t('overview.trafficSaved');
  $('usage-status').textContent = usage.available ? t('overview.updatedNote') : t('overview.unavailable');
  $('traffic-upload-bar').style.width = usage.total_bytes ? (usage.upload_bytes / usage.total_bytes * 100) + '%' : '0%';
  $('last-updated').textContent = t('overview.updated') + ' ' + new Date().toLocaleTimeString(lang === 'fa' ? 'fa-IR' : undefined, {hour: '2-digit', minute: '2-digit'});
  if (!s.server.persistent) notice(t('notice.persist'), true);
}

/* ================= proxies ================= */
function proxyLinksSummary(p) {
  return {tg: p.tg_link, web: p.web_link, host: p.host, port: p.public_port};
}
function renderProxies() {
  const list = $('proxy-list');
  const proxies = statusData?.proxies || [];
  list.innerHTML = '';
  $('proxy-empty').hidden = proxies.length > 0;
  if (!proxies.length) {
    const empty = $('proxy-empty');
    empty.innerHTML = esc(t('proxies.empty')) + '<div style="margin-top:18px"><button class="btn-primary-red" id="empty-add" type="button">+ ' + esc(t('proxies.createFirst')) + '</button></div>';
    $('empty-add').addEventListener('click', () => openProxyModal(null));
  }
  for (const p of proxies) list.appendChild(buildProxyCard(p));
  const note = $('network-note');
  note.hidden = Boolean(statusData?.server.network_ready);
  note.textContent = t('links.detecting');
}
function buildProxyCard(p) {
  const card = document.createElement('article');
  card.className = 'proxy-card' + (p.enabled ? '' : ' disabled');
  const running = p.enabled && p.running;
  const statusText = !p.enabled ? t('proxy.card.disabled') : running ? t('status.online') : t('status.starting');
  card.innerHTML = `
    <div class="proxy-head">
      <span class="status-dot${running ? '' : ' offline'}" aria-hidden="true"></span>
      <span class="proxy-name">${esc(p.name)}</span>
      ${p.is_default ? '<span class="mini-pill" title="">' + esc(t('proxy.card.default')) + '</span>' : ''}
      <span class="badge ${p.enabled ? (running ? 'on' : 'neutral') : ''}">${esc(statusText)}</span>
      <div class="proxy-badges"><span class="mini-pill" dir="ltr">${esc(t('proxy.card.port'))}: ${esc(p.port)}</span><span class="mini-pill" dir="ltr">${esc(p.tls_host)}</span></div>
    </div>
    <div class="proxy-stats">
      <div class="proxy-stat"><div class="metric-label">${esc(t('proxy.card.users'))}</div><div class="metric-val">${p.usage?.available && p.usage.users !== null ? p.usage.users.toLocaleString(lang === 'fa' ? 'fa-IR' : undefined) : '\u2014'}</div></div>
      <div class="proxy-stat"><div class="metric-label">${esc(t('proxy.card.connections'))}</div><div class="metric-val">${p.usage?.available ? p.usage.connections.toLocaleString(lang === 'fa' ? 'fa-IR' : undefined) : '\u2014'}</div></div>
      <div class="proxy-stat"><div class="metric-label">${esc(t('proxy.card.traffic'))}</div><div class="metric-val">${esc(bytes(p.usage?.total_bytes || 0))}</div></div>
      <div class="proxy-stat"><div class="metric-label">${esc(t('status.uptime'))}</div><div class="metric-val">${p.running && p.uptime ? esc(duration(p.uptime)) : '\u2014'}</div></div>
    </div>
    <div class="proxy-actions">
      <button class="btn-secondary-dark act-links" type="button">${esc(t('proxy.card.links'))}</button>
      <button class="btn-secondary-dark act-qr" type="button" ${p.tg_link ? '' : 'disabled'}>${esc(t('proxy.card.qr'))}</button>
      <button class="btn-secondary-dark act-copy-tg" type="button" ${p.tg_link ? '' : 'disabled'}>${esc(t('proxy.card.copyTg'))}</button>
      <button class="btn-secondary-dark act-copy-web" type="button" ${p.web_link ? '' : 'disabled'}>${esc(t('proxy.card.copyWeb'))}</button>
      <button class="btn-secondary-dark act-toggle" type="button">${esc(p.enabled ? t('proxy.card.disable') : t('proxy.card.enable'))}</button>
      <button class="btn-primary-red grow act-edit" type="button">${esc(t('proxy.card.edit'))}</button>
    </div>`;
  card.querySelector('.act-links').addEventListener('click', () => openProxyModal(p.id, 'general'));
  card.querySelector('.act-edit').addEventListener('click', () => openProxyModal(p.id, 'general'));
  card.querySelector('.act-qr').addEventListener('click', () => openQr(p.tg_link));
  card.querySelector('.act-copy-tg').addEventListener('click', () => copy(p.tg_link, t('links.tgLabel')));
  card.querySelector('.act-copy-web').addEventListener('click', () => copy(p.web_link, t('links.webLabel')));
  card.querySelector('.act-toggle').addEventListener('click', async () => {
    try {
      await api('/api/proxies/' + p.id, {enabled: !p.enabled});
      await refresh(true);
      notice(t('notice.saved'));
    } catch (error) { showError(error); }
  });
  return card;
}

/* ================= proxy modal ================= */
function setModalTab(tab) {
  for (const btn of document.querySelectorAll('.tab-btn')) btn.classList.toggle('active', btn.dataset.tab === tab);
  for (const section of ['general', 'sponsor', 'bridge']) $('tab-' + section).hidden = section !== tab;
}
function openProxyModal(proxyId, tab = 'general') {
  editingProxyId = proxyId;
  const p = proxyId ? (statusData?.proxies || []).find(x => x.id === proxyId) : null;
  if (proxyId && !p) return;
  $('proxy-modal-title').textContent = p ? p.name : t('proxies.add');
  $('proxy-name').value = p ? p.name : '';
  $('proxy-port').value = p ? p.port : '';
  $('proxy-host').value = p ? p.tls_host : '';
  $('host-field').hidden = false;
  $('enabled-row').hidden = !p;
  if (p) $('proxy-enabled').checked = p.enabled;
  $('general-save').textContent = p ? t('form.save') : t('form.create');
  $('general-save-note').textContent = p ? t('form.saveNote') : t('form.portHint');
  $('danger-zone').hidden = !p;
  if (p) fillSponsorForm(p), fillBridgeForm(p);
  else $('sponsor-badge').textContent = t('sponsor.notEnabled'), $('bridge-badge').textContent = t('bridge.disabled');
  setModalTab(tab);
  $('proxy-modal').hidden = false;
}
function closeProxyModal() { $('proxy-modal').hidden = true; editingProxyId = null; }
function fillSponsorForm(p) {
  $('channel').value = p.settings.channel;
  $('ad-tag').value = p.settings.ad_tag;
  $('sponsor-enabled').checked = p.settings.enabled;
  $('sponsor-badge').textContent = p.settings.enabled ? t('sponsor.configured') : t('sponsor.notEnabled');
  $('sponsor-badge').classList.toggle('on', p.settings.enabled);
}
function fillBridgeForm(p) {
  $('railway-origin').value = p.bridge.hosting_origin || '';
  $('worker-name').textContent = p.bridge.worker_name || 'aral-proxy-tg-...';
  $('worker-url').value = p.bridge.worker_url;
  $('public-ip').value = p.bridge.public_ip;
  $('bridge-enabled').checked = p.bridge.enabled;
  $('bridge-badge').textContent = p.bridge.enabled ? t('bridge.enabled') : t('bridge.disabled');
  $('bridge-badge').classList.toggle('on', p.bridge.enabled);
  $('bridge-link').value = p.bridge.tg_link || '';
  $('open-web-telegram').href = p.bridge.tg_link || '#/proxies';
  $('download-worker').href = '/api/proxies/' + p.id + '/bridge/standalone';
  $('download-bridge').href = '/api/proxies/' + p.id + '/bridge/bundle';
}
function currentProxy() { return editingProxyId ? (statusData?.proxies || []).find(x => x.id === editingProxyId) : null; }

$('add-proxy').addEventListener('click', () => openProxyModal(null));
$('proxy-modal-close').addEventListener('click', closeProxyModal);
$('proxy-modal').addEventListener('click', event => { if (event.target === $('proxy-modal')) closeProxyModal(); });
for (const btn of document.querySelectorAll('.tab-btn')) btn.addEventListener('click', () => setModalTab(btn.dataset.tab));
$('qr-modal-close').addEventListener('click', () => { $('qr-modal').hidden = true; });
$('qr-modal').addEventListener('click', event => { if (event.target === $('qr-modal')) $('qr-modal').hidden = true; });
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') { $('proxy-modal').hidden = true; $('qr-modal').hidden = true; }
});

$('general-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (saving) return;
  saving = true;
  const button = $('general-save');
  button.disabled = true;
  const original = button.textContent;
  const name = $('proxy-name').value.trim();
  const portRaw = $('proxy-port').value.trim();
  const host = $('proxy-host').value.trim();
  try {
    if (!editingProxyId) {
      button.textContent = t('form.creating');
      const payload = {name};
      if (portRaw) payload.port = Number(portRaw);
      if (host) payload.tls_host = host;
      const created = await api('/api/proxies', payload);
      notice(t('notice.created', {name: created.name}));
      closeProxyModal();
      await refresh(true);
    } else {
      const payload = {name};
      if (portRaw) payload.port = Number(portRaw);
      if (host) payload.tls_host = host;
      payload.enabled = $('proxy-enabled').checked;
      await api('/api/proxies/' + editingProxyId, payload);
      notice(t('notice.saved'));
      await refresh(true);
      const p = currentProxy();
      if (p) { $('proxy-modal-title').textContent = p.name; fillSponsorForm(p); fillBridgeForm(p); }
    }
  } catch (error) { showError(error); button.textContent = original; }
  finally { saving = false; button.disabled = false; if (!button.textContent || button.textContent === '') button.textContent = original; }
});

$('proxy-delete').addEventListener('click', async () => {
  if (!editingProxyId) return;
  if (!confirm(t('form.deleteConfirm'))) return;
  try {
    await api('/api/proxies/' + editingProxyId, null, 'DELETE');
    notice(t('notice.deleted'));
    closeProxyModal();
    await refresh(true);
  } catch (error) { showError(error); }
});

$('sponsor-form').addEventListener('submit', async event => {
  event.preventDefault();
  const p = currentProxy();
  if (saving || !p) return;
  const payload = {enabled: $('sponsor-enabled').checked, channel: $('channel').value.trim(), ad_tag: $('ad-tag').value.trim()};
  if (payload.enabled && !/^[a-fA-F0-9]{32}$/.test(payload.ad_tag)) {
    notice(t('notice.sponsorNeedTag'), true);
    $('ad-tag').focus();
    return;
  }
  const needsRestart = payload.enabled !== p.settings.enabled || (payload.enabled && payload.ad_tag.toLowerCase() !== p.settings.ad_tag);
  if (needsRestart && !confirm(t('notice.restartConfirm'))) return;
  saving = true;
  $('sponsor-save').disabled = true;
  try {
    await api('/api/proxies/' + p.id, {sponsor: payload});
    await refresh(true);
    const updated = currentProxy();
    if (updated) fillSponsorForm(updated);
    notice(payload.enabled ? t('notice.sponsorSaved') : t('notice.sponsorOff'));
  } catch (error) { showError(error); }
  finally { saving = false; $('sponsor-save').disabled = false; }
});
$('copy-key').addEventListener('click', () => { const p = currentProxy(); if (p) copy(p.registration_secret, t('sponsor.copyKey')); });

$('worker-url').addEventListener('input', () => { $('public-ip').value = ''; });
$('bridge-form').addEventListener('submit', async event => {
  event.preventDefault();
  const p = currentProxy();
  if (saving || !p) return;
  saving = true;
  $('save-bridge').disabled = true;
  try {
    await api('/api/proxies/' + p.id, {bridge: {worker_url: $('worker-url').value.trim(), enabled: $('bridge-enabled').checked, public_ip: $('public-ip').value.trim()}});
    await refresh(true);
    const updated = currentProxy();
    if (updated) fillBridgeForm(updated);
    notice(t('notice.bridgeSaved'));
  } catch (error) { showError(error); }
  finally { saving = false; $('save-bridge').disabled = false; }
});
async function loadWorkerCode(reveal = false) {
  const p = currentProxy();
  if (!p) return '';
  const response = await fetch('/api/proxies/' + p.id + '/bridge/standalone', {credentials: 'same-origin'});
  if (!response.ok) throw {message: t('err.session'), code: 'session'};
  const source = await response.text();
  $('worker-source').value = source;
  $('worker-source-box').open = reveal;
  return source;
}
$('copy-worker-code').addEventListener('click', async () => {
  try { await copy(await loadWorkerCode(), t('bridge.copyWorker'), $('worker-source')); }
  catch (error) { showError(error); }
});
$('load-worker-code').addEventListener('click', () => loadWorkerCode(true).catch(error => showError(error)));
$('copy-bridge-token').addEventListener('click', async () => {
  const p = currentProxy();
  if (!p) return;
  try {
    const result = await api('/api/proxies/' + p.id + '/bridge/token');
    $('bridge-token').value = result.token;
    await copy(result.token, t('bridge.tokenLabel'), $('bridge-token'));
  } catch (error) { showError(error); }
});
$('copy-bridge-link').addEventListener('click', () => copy($('bridge-link').value, t('bridge.copyLink'), $('bridge-link')));

/* ================= QR ================= */
function openQr(link) {
  if (!link) { notice(t('qr.notReady'), true); return; }
  const box = $('qr-box');
  box.innerHTML = '';
  $('qr-link').textContent = link;
  $('qr-open').href = link;
  try {
    const qr = window.QRCode.encode(link, {level: 'M'});
    const size = qr.size, scale = 6, quiet = 3;
    const total = (size + quiet * 2) * scale;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 ' + total + ' ' + total);
    svg.setAttribute('role', 'img');
    const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    bg.setAttribute('width', total); bg.setAttribute('height', total); bg.setAttribute('fill', '#ffffff');
    svg.appendChild(bg);
    for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) {
      if (!qr.matrix[r][c]) continue;
      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rect.setAttribute('x', (c + quiet) * scale);
      rect.setAttribute('y', (r + quiet) * scale);
      rect.setAttribute('width', scale); rect.setAttribute('height', scale);
      rect.setAttribute('fill', '#0b0e17');
      svg.appendChild(rect);
    }
    box.appendChild(svg);
    $('qr-modal').hidden = false;
  } catch { notice(t('qr.notReady'), true); }
}
$('qr-copy').addEventListener('click', () => copy($('qr-link').textContent, t('qr.title')));

/* ================= guide ================= */
function renderGuide() {
  const sections = I18N[lang].guide || [];
  const toc = $('guide-toc');
  const content = $('guide-content');
  if (!toc || !content) return;
  toc.innerHTML = '';
  content.innerHTML = '';
  sections.forEach(([id, title, html], index) => {
    const a = document.createElement('a');
    a.href = '#guide-' + id;
    a.textContent = (index + 1) + '. ' + title;
    toc.appendChild(a);
    const section = document.createElement('section');
    section.className = 'guide-section';
    section.id = 'guide-' + id;
    section.innerHTML = '<h2><span class="guide-num">' + (index + 1) + '</span>' + esc(title) + '</h2>' + html;
    content.appendChild(section);
  });
}

/* ================= lifecycle ================= */
async function refresh(force = false) {
  const s = await api('/api/status');
  statusData = s;
  $('login-view').hidden = true;
  $('setup-view').hidden = true;
  $('dashboard').hidden = false;
  renderOverview();
  renderProxies();
  renderRoute(false);
}
$('login-form').addEventListener('submit', async event => {
  event.preventDefault();
  const button = event.submitter || $('login-form').querySelector('button');
  button.disabled = true;
  $('login-error').textContent = '';
  try {
    await api('/api/login', {password: $('password').value});
    $('password').value = '';
    $('notice').hidden = true;
    await refresh(true);
  } catch (error) { $('login-error').textContent = error.code ? t('err.' + error.code) || error.message : error.message; }
  finally { button.disabled = false; }
});
$('setup-form').addEventListener('submit', async event => {
  event.preventDefault();
  const password = $('setup-password').value;
  if (password !== $('setup-confirm').value) { $('setup-error').textContent = t('err.invalid_password'); return; }
  const button = $('setup-form').querySelector('button');
  button.disabled = true;
  $('setup-error').textContent = '';
  try {
    await api('/api/setup', {code: $('setup-code').value.trim(), password});
    $('setup-form').reset();
    await api('/api/login', {password});
    await refresh(true);
  } catch (error) { $('setup-error').textContent = error.code ? (t('err.' + error.code) || error.message) : error.message; }
  finally { button.disabled = false; }
});
$('refresh').addEventListener('click', async () => {
  $('refresh').disabled = true;
  try { await refresh(); } catch (error) { showError(error); }
  finally { $('refresh').disabled = false; }
});
$('logout').addEventListener('click', async () => {
  try { await api('/api/logout', {}); }
  catch (error) { showError(error); return; }
  renderProxies(); // clears DOM references
  showLogin();
});
$('theme-toggle').addEventListener('click', () => applyTheme(document.body.dataset.theme === 'light' ? 'dark' : 'light'));
$('lang-fa').addEventListener('click', () => applyLanguage('fa'));
$('lang-en').addEventListener('click', () => applyLanguage('en'));
window.addEventListener('hashchange', () => renderRoute(true));

async function initialize() {
  let initialTheme = 'dark';
  try { initialTheme = localStorage.getItem('aral-theme') || localStorage.getItem('blueknight-theme') || 'dark'; } catch {}
  if (initialTheme === 'cozy') initialTheme = 'dark';
  applyTheme(initialTheme, false);
  applyLanguage(lang, false);
  renderGuide();
  renderRoute(false);
  try {
    const setup = await api('/api/setup/status');
    if (setup.required) {
      $('login-view').hidden = true;
      $('dashboard').hidden = true;
      $('setup-view').hidden = false;
      return;
    }
    await refresh();
    clearInterval(refreshTimer);
    refreshTimer = setInterval(() => { if (statusData && !saving && $('proxy-modal').hidden) refresh().catch(() => {}); }, 15000);
  } catch { showLogin(); }
}
initialize();
