document.addEventListener('DOMContentLoaded', () => {

  /* ---------- navbar scroll state ---------- */
  const navbar = document.querySelector('.navbar');
  const onScroll = () => {
    if (!navbar) return;
    navbar.classList.toggle('scrolled', window.scrollY > 10);
  };
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });

  /* ---------- mobile nav ---------- */
  const navToggle = document.querySelector('.nav-toggle');
  const mobileNav = document.querySelector('.mobile-nav');
  const navScrim = document.querySelector('.nav-scrim');

  const closeMobileNav = () => {
    navToggle && navToggle.classList.remove('open');
    mobileNav && mobileNav.classList.remove('open');
    navScrim && navScrim.classList.remove('open');
  };

  if (navToggle && mobileNav && navScrim) {
    navToggle.addEventListener('click', () => {
      const open = !mobileNav.classList.contains('open');
      navToggle.classList.toggle('open', open);
      mobileNav.classList.toggle('open', open);
      navScrim.classList.toggle('open', open);
    });
    navScrim.addEventListener('click', closeMobileNav);
    mobileNav.querySelectorAll('a').forEach(a => a.addEventListener('click', closeMobileNav));
  }

  /* ---------- auto-panning screenshot reels ---------- */
  document.querySelectorAll('.scroll-window img').forEach(img => {
    const setup = () => {
      const winHeight = img.parentElement.clientHeight;
      const displayWidth = img.clientWidth;
      if (!img.naturalWidth || !displayWidth) return;
      const imgHeight = img.naturalHeight * (displayWidth / img.naturalWidth);
      const travel = Math.max(imgHeight - winHeight, 0);
      if (travel < 20) return;
      img.style.setProperty('--travel', `-${travel}px`);
      const duration = Math.min(Math.max(travel / 18, 6), 22);
      const delay = -(Math.random() * duration).toFixed(2);
      img.style.animation = `pan-y ${duration}s ease-in-out ${delay}s infinite alternate`;
    };
    if (img.complete && img.naturalWidth) {
      setup();
    } else {
      img.addEventListener('load', setup);
      img.addEventListener('error', () => {
        img.style.display = 'none';
      });
    }
  });

  /* ---------- preview videos: keep paused off-screen to save bandwidth ---------- */
  const previewVideos = document.querySelectorAll('video.preview-video');
  if ('IntersectionObserver' in window && previewVideos.length) {
    const vio = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        const v = entry.target;
        if (entry.isIntersecting) {
          v.play().catch(() => {});
        } else {
          v.pause();
        }
      });
    }, { threshold: 0.2 });
    previewVideos.forEach(v => vio.observe(v));
  }

  /* ---------- full-tour lightbox ---------- */
  const lightbox = document.getElementById('video-lightbox');
  const lightboxVideo = document.getElementById('lightbox-video');
  const lightboxTitle = document.getElementById('lightbox-title');
  const lightboxClose = document.querySelector('.lightbox-close');

  const openLightbox = (src, title) => {
    if (!lightbox || !lightboxVideo) return;
    lightboxVideo.src = src;
    lightboxVideo.currentTime = 0;
    lightboxVideo.muted = false;
    if (lightboxTitle) lightboxTitle.textContent = title || '';
    lightbox.classList.add('open');
    document.body.style.overflow = 'hidden';
    lightboxVideo.play().catch(() => {});
  };

  const closeLightbox = () => {
    if (!lightbox || !lightboxVideo) return;
    lightbox.classList.remove('open');
    lightboxVideo.pause();
    lightboxVideo.removeAttribute('src');
    lightboxVideo.load();
    document.body.style.overflow = '';
  };

  document.querySelectorAll('.play-full').forEach(btn => {
    btn.addEventListener('click', () => {
      openLightbox(btn.dataset.video, btn.dataset.title);
    });
  });

  lightboxClose && lightboxClose.addEventListener('click', closeLightbox);
  lightbox && lightbox.addEventListener('click', (e) => {
    if (e.target === lightbox) closeLightbox();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeLightbox();
  });

  /* ---------- motion: reveals, headline words, progress bar, parallax ---------- */
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  try {
    const io = 'IntersectionObserver' in window
      ? new IntersectionObserver((entries) => {
          entries.forEach(entry => {
            if (entry.isIntersecting) {
              entry.target.classList.add('in');
              io.unobserve(entry.target);
            }
          });
        }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' })
      : null;

    const watch = (el) => { if (io) io.observe(el); else el.classList.add('in'); };

    // Split a headline into words so each can slide up on its own.
    const splitWords = (el) => {
      let i = 0;
      const walk = (node) => {
        [...node.childNodes].forEach(child => {
          if (child.nodeType === 3) {
            const frag = document.createDocumentFragment();
            child.textContent.split(/(\s+)/).forEach(part => {
              if (!part) return;
              if (/^\s+$/.test(part)) { frag.appendChild(document.createTextNode(' ')); return; }
              const w = document.createElement('span');
              w.className = 'w';
              const inner = document.createElement('span');
              inner.className = 'wi';
              inner.style.setProperty('--i', i++);
              inner.textContent = part;
              w.appendChild(inner);
              frag.appendChild(w);
            });
            child.replaceWith(frag);
          } else if (child.nodeType === 1) {
            walk(child);
          }
        });
      };
      walk(el);
      el.setAttribute('data-split', '');
      watch(el);
    };

    document.querySelectorAll('.hero h1, .page-hero h1, .about h2, .work-head h2, .process h2, .cta h2').forEach(splitWords);

    // Group reveals: each child of a parent enters a beat after the previous one.
    const group = (sel, { type = 'up', base = 0, step = 0.09 } = {}) => {
      const seen = new Map();
      document.querySelectorAll(sel).forEach(el => {
        const k = el.parentElement;
        const n = seen.get(k) || 0;
        seen.set(k, n + 1);
        el.setAttribute('data-reveal', type);
        el.style.setProperty('--d', (base + Math.min(n, 8) * step).toFixed(2) + 's');
        watch(el);
      });
    };

    group('.hero .lede', { base: 0.45 });
    group('.hero-actions', { base: 0.6 });
    group('.index li', { base: 0.7, step: 0.07 });
    group('.page-hero p', { base: 0.35 });
    group('.about-points p');
    group('.work-head p', { base: 0.15 });
    group('.project-text > *', { step: 0.1 });
    group('.project-media', { type: 'wipe', base: 0.1 });
    group('.features li', { base: 0.3, step: 0.08 });
    group('.steps li', { step: 0.12 });
    group('.cta p', { base: 0.2 });
    group('.cta .btn', { base: 0.35 });
    group('.contact-info > div', { step: 0.1 });
    group('.contact-form h2');
    group('.contact-form .field', { base: 0.1, step: 0.07 });
    group('.contact-form .btn', { base: 0.2 });
    group('.footer-grid > *', { step: 0.12 });
    group('.marquee', { base: 0.2 });
    document.querySelectorAll('.project').forEach(watch);

    // Scroll progress bar + gentle parallax on project media.
    const bar = document.querySelector('.progress');
    const frames = [...document.querySelectorAll('.project-media .frame')];
    let ticking = false;
    const update = () => {
      ticking = false;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      if (bar) bar.style.transform = `scaleX(${max > 0 ? Math.min(window.scrollY / max, 1) : 0})`;
      if (reduceMotion) return;
      const vh = window.innerHeight;
      frames.forEach(f => {
        const r = f.getBoundingClientRect();
        if (r.bottom < -100 || r.top > vh + 100) return;
        const offset = (r.top + r.height / 2 - vh / 2) / vh;
        f.style.transform = `translateY(${(offset * -28).toFixed(1)}px)`;
      });
    };
    window.addEventListener('scroll', () => {
      if (!ticking) { ticking = true; requestAnimationFrame(update); }
    }, { passive: true });
    window.addEventListener('resize', update);
    update();
  } catch (err) {
    document.documentElement.classList.add('no-motion');
  }

  /* ---------- share buttons ---------- */
  /* Shares the project's /share/<id>/ page, which carries the thumbnail (Open Graph) tags. */
  const SHARE_BASE = 'https://everythingshul.com/share/';

  const copyText = async (text) => {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return;
    }
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  };

  document.querySelectorAll('.share-btn').forEach(btn => {
    const label = btn.querySelector('span');
    btn.addEventListener('click', async () => {
      const url = `${SHARE_BASE}${btn.dataset.id}/`;
      if (navigator.share) {
        try {
          await navigator.share({ title: btn.dataset.title, text: btn.dataset.text, url });
          return;
        } catch (err) {
          if (err && err.name === 'AbortError') return;
        }
      }
      try {
        await copyText(url);
        label.textContent = 'Link copied';
      } catch (err) {
        label.textContent = 'Copy failed';
      }
      setTimeout(() => { label.textContent = 'Share'; }, 2000);
    });
  });

  /* ---------- contact form ---------- */
  const form = document.getElementById('contact-form');
  if (form) {
    const ENDPOINT = 'https://everythingshul-contact.everythingshul.workers.dev';
    const success = document.querySelector('.form-success');
    const error = document.querySelector('.form-error');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = form.querySelector('button[type="submit"]');
      const label = btn.textContent;
      btn.disabled = true;
      btn.textContent = 'Sending...';
      if (error) error.style.display = 'none';
      try {
        const res = await fetch(ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(Object.fromEntries(new FormData(form)))
        });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'failed');
        form.reset();
        if (success) success.classList.add('show');
      } catch (err) {
        // Worker unreachable: fall back to the visitor's email app so the message is never lost.
        const d = Object.fromEntries(new FormData(form));
        const lines = [
          `Name: ${d.name}`,
          `Email: ${d.email}`,
          d.org ? `Organization: ${d.org}` : null,
          d.interest ? `Interested in: ${d.interest}` : null,
          '',
          d.message
        ].filter((l) => l !== null);
        window.location.href = `mailto:everythingshul@gmail.com?subject=${encodeURIComponent('Project inquiry from ' + (d.name || 'your site'))}&body=${encodeURIComponent(lines.join('\n'))}`;
        if (error) {
          error.textContent = 'Opening your email app so you can send it directly.';
          error.style.display = 'block';
        }
      } finally {
        btn.disabled = false;
        btn.textContent = label;
      }
    });
  }

});
