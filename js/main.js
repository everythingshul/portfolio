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

  /* ---------- scroll reveal ---------- */
  const revealEls = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window && revealEls.length) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('in-view');
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.14, rootMargin: '0px 0px -60px 0px' });
    revealEls.forEach(el => io.observe(el));
  } else {
    revealEls.forEach(el => el.classList.add('in-view'));
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
      img.closest('.scroll-window')?.querySelector('.fallback')?.remove();
    } else {
      img.addEventListener('load', () => {
        setup();
        img.closest('.scroll-window')?.querySelector('.fallback')?.remove();
      });
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

  /* ---------- contact form ---------- */
  const form = document.getElementById('contact-form');
  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const data = new FormData(form);
      const name = (data.get('name') || '').toString();
      const email = (data.get('email') || '').toString();
      const org = (data.get('org') || '').toString();
      const interest = (data.get('interest') || '').toString();
      const message = (data.get('message') || '').toString();

      const subject = `Project inquiry from ${name || 'your site'}`;
      const bodyLines = [
        `Name: ${name}`,
        `Email: ${email}`,
        org ? `Organization: ${org}` : null,
        interest ? `Interested in: ${interest}` : null,
        '',
        message
      ].filter(Boolean);

      const mailto = `mailto:everythingshul@gmail.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(bodyLines.join('\n'))}`;
      window.location.href = mailto;

      const success = document.querySelector('.form-success');
      if (success) success.classList.add('show');
    });
  }

});
