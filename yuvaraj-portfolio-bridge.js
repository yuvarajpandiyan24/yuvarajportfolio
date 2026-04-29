/**
 * yuvaraj-portfolio-bridge.js
 * ─────────────────────────────────────────────────────────────────
 * Connects the Portfolio CMS → Cloudflare Worker API → Portfolio UI
 *
 * Priority order:
 *   1. Fetch live data from Cloudflare Worker API (always fresh)
 *   2. Fall back to localStorage ypa_* keys (offline / same-device)
 *   3. Fall back to static HTML already on the page
 *
 * The CMS dual-writes to localStorage under ypa_* on every save,
 * so same-device preview is instant without needing a sync.
 * ─────────────────────────────────────────────────────────────────
 */
(function () {
  'use strict';

  /* ── CONFIG ───────────────────────────────────────────────────── */
  const WORKER_BASE = 'https://yuvarajpandian-api.yuvarajpandian243.workers.dev';
  const YPA = 'ypa_';
  const CACHE_TTL = 60 * 1000; // 1 min — re-fetch from Worker after this

  /* ── HELPERS ──────────────────────────────────────────────────── */
  function ls(key) {
    try { return JSON.parse(localStorage.getItem(YPA + key) || 'null'); } catch { return null; }
  }

  function cacheGet(key) {
    try {
      const raw = sessionStorage.getItem('pf_cache_' + key);
      if (!raw) return null;
      const { ts, data } = JSON.parse(raw);
      if (Date.now() - ts > CACHE_TTL) return null;
      return data;
    } catch { return null; }
  }

  function cacheSet(key, data) {
    try { sessionStorage.setItem('pf_cache_' + key, JSON.stringify({ ts: Date.now(), data })); } catch {}
  }

  async function fetchSection(section) {
    const cached = cacheGet(section);
    if (cached) return cached;
    try {
      const res = await fetch(WORKER_BASE + '/api/' + section, { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      cacheSet(section, data);
      // Also write back to localStorage so offline still works
      try { localStorage.setItem(YPA + section, JSON.stringify(data)); } catch {}
      return data;
    } catch (e) {
      console.warn('[Bridge] Worker fetch failed for', section, '—', e.message, '— using localStorage');
      return ls(section);
    }
  }

  /* ── PUBLIC API (same contract as before, now async-aware) ────── */

  // getAdminBlogs() — returns published posts sorted newest first
  window.getAdminBlogs = async function () {
    const posts = await fetchSection('blog');
    if (!posts) return [];
    return posts
      .filter(b => b.status === 'published')
      .sort((a, b) => new Date(b.publishedAt || b.createdAt) - new Date(a.publishedAt || a.createdAt));
  };

  // Sync version for code that still calls it synchronously
  window.getAdminBlogsSync = function () {
    const posts = ls('blog');
    if (!posts) return [];
    return posts
      .filter(b => b.status === 'published')
      .sort((a, b) => new Date(b.publishedAt || b.createdAt) - new Date(a.publishedAt || a.createdAt));
  };

  // getAdminSection(key) — any section
  window.getAdminSection = async function (key) {
    return await fetchSection(key);
  };

  window.getAdminSectionSync = function (key) {
    return ls(key) || [];
  };

  // submitToAdmin — saves contact form to localStorage AND posts to Worker
  window.submitToAdmin = async function (name, email, subject, msg) {
    const item = {
      id: 'id_' + Date.now(),
      name, email, subject, msg,
      read: false,
      createdAt: new Date().toISOString()
    };

    // Write to localStorage immediately (same-device admin sees it)
    const existing = ls('contact_inbox') || [];
    existing.push(item);
    try { localStorage.setItem(YPA + 'contact_inbox', JSON.stringify(existing)); } catch {}

    // Also POST to Worker so it persists in D1
    try {
      await fetch(WORKER_BASE + '/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, subject: subject || 'Portfolio Enquiry', message: msg, source: 'portfolio' })
      });
    } catch (e) {
      console.warn('[Bridge] Contact POST to Worker failed:', e.message);
    }

    window.dispatchEvent(new StorageEvent('storage', { key: YPA + 'contact_inbox', storageArea: localStorage }));
    return true;
  };

  /* ── AUTO-RENDER: Blog section on index.html ──────────────────── */
  async function renderBlogSection() {
    const posts = await window.getAdminBlogs();
    if (!posts || !posts.length) return;

    const catClass = { engineering: 'cat-dev', qa: 'cat-qa', content: 'cat-content', career: 'cat-dev' };
    const catLabel = { engineering: 'Engineering', qa: 'QA / Testing', content: 'Content', career: 'Career' };

    function fmt(iso) {
      if (!iso) return '';
      return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    }

    // ── Featured post (first published)
    const featured = posts[0];
    const featuredEl = document.querySelector('.blog-card.featured');
    if (featuredEl && featured) {
      const cat = featured.category || 'engineering';
      featuredEl.href = 'blog.html#post-' + featured.id;
      featuredEl.querySelector('.blog-category').className = 'blog-category ' + (catClass[cat] || 'cat-dev');
      featuredEl.querySelector('.blog-category').textContent = catLabel[cat] || cat;
      featuredEl.querySelector('.blog-date').textContent = fmt(featured.publishedAt || featured.createdAt);
      const rt = featuredEl.querySelector('.blog-read-time');
      if (rt) rt.textContent = (featured.readTime || '5') + ' min read';
      featuredEl.querySelector('.blog-title').textContent = featured.title;
      const exc = featuredEl.querySelector('.blog-excerpt');
      if (exc) exc.textContent = featured.excerpt || '';
      // Tags
      const tagsEl = featuredEl.querySelector('.blog-tags');
      if (tagsEl && featured.tags) {
        tagsEl.innerHTML = featured.tags.split(',').filter(t => t.trim())
          .map(t => `<span class="blog-tag">${t.trim()}</span>`).join('');
      }
    }

    // ── Small cards (posts 1 & 2)
    const smallCards = document.querySelectorAll('.blog-card.small');
    [1, 2].forEach((i, idx) => {
      const post = posts[i];
      const el = smallCards[idx];
      if (!el || !post) return;
      const cat = post.category || 'engineering';
      el.href = 'blog.html#post-' + post.id;
      const numEl = el.querySelector('.blog-num');
      if (numEl) numEl.textContent = String(i + 1).padStart(2, '0');
      el.querySelector('.blog-category').className = 'blog-category ' + (catClass[cat] || 'cat-dev');
      el.querySelector('.blog-category').textContent = catLabel[cat] || cat;
      el.querySelector('.blog-date').textContent = fmt(post.publishedAt || post.createdAt);
      const rt = el.querySelector('.blog-read-time');
      if (rt) rt.textContent = (post.readTime || '4') + ' min read';
      el.querySelector('.blog-title').textContent = post.title;
      const tagsEl = el.querySelector('.blog-tags');
      if (tagsEl && post.tags) {
        tagsEl.innerHTML = post.tags.split(',').filter(t => t.trim())
          .map(t => `<span class="blog-tag">${t.trim()}</span>`).join('');
      }
    });

    // ── Mini strip (posts 3-5)
    const miniCards = document.querySelectorAll('.blog-mini-card');
    [3, 4, 5].forEach((i, idx) => {
      const post = posts[i];
      const el = miniCards[idx];
      if (!el || !post) return;
      const cat = post.category || 'engineering';
      el.href = 'blog.html#post-' + post.id;
      const labelEl = el.querySelector('.mini-label');
      if (labelEl) labelEl.textContent = fmt(post.publishedAt || post.createdAt) + ' · ' + (catLabel[cat] || cat);
      const titleEl = el.querySelector('.mini-title');
      if (titleEl) titleEl.textContent = post.title;
    });
  }

  /* ── AUTO-RENDER: Works section on index.html ─────────────────── */
  async function renderWorksSection() {
    const works = await fetchSection('works');
    if (!works || !works.length) return;

    const grid = document.querySelector('.works-grid');
    if (!grid) return;

    const typeClass = { 'Web App': 'dev', 'API / Backend': 'dev', 'CLI Tool': 'dev', 'Library': 'dev', 'Mobile App': 'dev', 'QA / Testing': 'qa', 'Content': 'content', 'Other': 'dev' };
    const typeLabel = { live: 'Live', wip: 'In Progress', draft: 'Draft' };

    const featured = works.slice(0, 6);
    grid.innerHTML = featured.map((w, i) => {
      const cls = typeClass[w.category] || 'dev';
      const tech = (w.tech || '').split(',').filter(t => t.trim()).map(t => `<span class="work-tag">${t.trim()}</span>`).join('');
      return `
        <div class="work-card ${cls} reveal reveal-delay-${i % 4}">
          <div class="work-num">${String(i + 1).padStart(2, '0')}</div>
          <div class="work-type">${w.category}</div>
          <h3 class="work-title">${w.title}</h3>
          <p class="work-desc">${w.desc || ''}</p>
          <div class="work-tags">${tech}</div>
          ${w.live ? `<a href="${w.live}" target="_blank" rel="noopener" class="work-arrow" style="text-decoration:none;">↗</a>` : '<div class="work-arrow">↗</div>'}
        </div>`;
    }).join('');

    // Re-observe new elements for scroll reveal
    if (window._portfolioObserver) {
      grid.querySelectorAll('.reveal').forEach(el => window._portfolioObserver.observe(el));
    }
  }

  /* ── AUTO-RENDER: Experience section ──────────────────────────── */
  async function renderExperienceSection() {
    const exps = await fetchSection('experience');
    if (!exps || !exps.length) return;

    const timeline = document.querySelector('.exp-timeline');
    if (!timeline) return;

    const badgeMap = { Engineering: 'badge-dev', QA: 'badge-qa', Content: 'badge-content' };

    timeline.innerHTML = exps.map((e, i) => `
      <div class="exp-item reveal reveal-delay-${i}">
        <div class="exp-date">
          <span class="year">${(e.start || '').slice(0, 4)}</span>
          ${e.start || ''} — ${e.current ? 'Present' : (e.end || '')}
        </div>
        <div class="exp-content">
          <div class="exp-role">${e.role}</div>
          <div class="exp-company">${e.company}</div>
          <p class="exp-desc">${e.desc || ''}</p>
          <div class="exp-skills">
            ${(e.skills || '').split(',').filter(s => s.trim()).map(s => `<span class="exp-skill">${s.trim()}</span>`).join('')}
          </div>
        </div>
        <div class="exp-badges">
          <span class="exp-type-badge badge-dev">Engineering</span>
        </div>
      </div>`).join('');

    if (window._portfolioObserver) {
      timeline.querySelectorAll('.reveal').forEach(el => window._portfolioObserver.observe(el));
    }
  }

  /* ── FULL PORTFOLIO PAGE: blog.html ───────────────────────────── */
  async function renderBlogPage() {
    const container = document.getElementById('blog-posts-container');
    if (!container) return;

    const posts = await window.getAdminBlogs();
    const catClass = { engineering: 'cat-dev', qa: 'cat-qa', content: 'cat-content', career: 'cat-dev' };
    const catLabel = { engineering: 'Engineering', qa: 'QA / Testing', content: 'Content', career: 'Career' };

    function fmt(iso) {
      if (!iso) return '';
      return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    }

    if (!posts || !posts.length) {
      container.innerHTML = '<p style="color:var(--text-dim);text-align:center;padding:4rem 0;">No posts published yet. Check back soon!</p>';
      return;
    }

    container.innerHTML = posts.map((b, i) => `
      <article id="post-${b.id}" class="blog-full-card reveal" style="
        background:var(--surface);border:1px solid var(--border);
        padding:2rem;margin-bottom:2px;
        transition:border-color .3s;
      ">
        <div class="blog-meta">
          <span class="blog-category ${catClass[b.category] || 'cat-dev'}">${catLabel[b.category] || b.category}</span>
          <span class="blog-date">${fmt(b.publishedAt || b.createdAt)}</span>
          <span class="blog-read-time">${b.readTime || '5'} min read</span>
        </div>
        <h2 style="font-family:'Syne',sans-serif;font-size:1.4rem;font-weight:700;margin:0.75rem 0;line-height:1.2;">${b.title}</h2>
        ${b.excerpt ? `<p style="color:var(--text-dim);font-size:.8rem;line-height:1.75;margin-bottom:1rem;">${b.excerpt}</p>` : ''}
        ${b.content ? `
          <details style="margin-top:1rem;">
            <summary style="cursor:pointer;color:var(--accent1);font-size:.72rem;letter-spacing:.1em;text-transform:uppercase;">Read Full Article →</summary>
            <div style="margin-top:1.25rem;color:var(--text-dim);font-size:.8rem;line-height:1.85;white-space:pre-wrap;">${b.content}</div>
          </details>` : ''}
        ${b.tags ? `
          <div class="blog-tags" style="margin-top:1rem;">
            ${b.tags.split(',').filter(t=>t.trim()).map(t=>`<span class="blog-tag">${t.trim()}</span>`).join('')}
          </div>` : ''}
      </article>`).join('');

    if (window._portfolioObserver) {
      container.querySelectorAll('.reveal').forEach(el => window._portfolioObserver.observe(el));
    }
  }

  /* ── INIT ─────────────────────────────────────────────────────── */
  function init() {
    // Store the intersection observer reference so render fns can use it
    window._portfolioObserver = new IntersectionObserver(entries => {
      entries.forEach(e => { if (e.isIntersecting) e.target.classList.add('visible'); });
    }, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });

    // Run renders based on current page
    const path = location.pathname;

    if (path.endsWith('blog.html') || path.includes('/blog')) {
      renderBlogPage();
    } else {
      // index.html — render all visible sections
      renderBlogSection();
      renderWorksSection();
      renderExperienceSection();
    }

    // Listen for CMS saves (same-device, same-origin) to update instantly
    window.addEventListener('storage', function (e) {
      if (e.key && e.key.startsWith(YPA)) {
        // Invalidate cache and re-render
        try { sessionStorage.clear(); } catch {}
        if (path.endsWith('blog.html')) renderBlogPage();
        else {
          renderBlogSection();
          renderWorksSection();
          renderExperienceSection();
        }
      }
    });

    window.addEventListener('adminReady', function () {
      if (path.endsWith('blog.html')) renderBlogPage();
      else {
        renderBlogSection();
        renderWorksSection();
        renderExperienceSection();
      }
    });
  }

  // Run after DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
