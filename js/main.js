// Everything Shul — site interactions
document.addEventListener('DOMContentLoaded', () => {

  /* ---- navbar scroll state ---- */
  const navbar = document.querySelector('.navbar');
  const onScroll = () => {
    if (window.scrollY > 20) navbar.classList.add('scrolled');
    else navbar.classList.remove('scrolled');
  };
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });

  /* ---- mobile nav ---- */
  const toggle = document.querySelector('.nav-toggle');
  const mobileNav = document.querySelector('.mobile-nav');
  const scrim = document.querySelector('.nav-scrim');
  if (toggle && mobileNav && scrim) {
    const closeNav = () => { mobileNav.classList.remove('open'); scrim.classList.remove('open'); };
    toggle.addEventListener('click', () => {
      mobileNav.classList.toggle('open');
      scrim.classList.toggle('open');
    });
    scrim.addEventListener('click', closeNav);
    mobileNav.querySelectorAll('a').forEach(a => a.addEventListener('click', closeNav));
  }

  /* ---- reveal on scroll ---- */
  const revealEls = document.querySelectorAll('.reveal');
  const io = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('in-view');
        io.unobserve(entry.target);
      }
    });
  }, { threshold: 0.15, rootMargin: '0px 0px -40px 0px' });
  revealEls.forEach(el => io.observe(el));

  /* ---- animated screenshot scroll (ken-burns style auto pan) ---- */
  const windows = document.querySelectorAll('.scroll-window');
  windows.forEach((win) => {
    const img = win.querySelector('img');
    if (!img) return;

    const fallback = win.querySelector('.fallback');

    const setup = () => {
      const winHeight = win.clientHeight;
      const imgHeight = img.naturalHeight * (win.clientWidth / img.naturalWidth);
      const travel = Math.max(imgHeight - winHeight, 0);

      if (travel < 20) return; // nothing meaningful to scroll

      const duration = Math.min(Math.max(travel / 18, 6), 22); // seconds, scaled to distance
      img.style.setProperty('--travel', `-${travel}px`);
      img.style.animation = `pan-y ${duration}s ease-in-out ${Math.random() * -duration}s infinite alternate`;
    };

    if (img.complete && img.naturalHeight) {
      setup();
      if (fallback) fallback.remove();
    } else {
      img.addEventListener('load', () => {
        setup();
        if (fallback) fallback.remove();
      });
      img.addEventListener('error', () => {
        img.style.display = 'none';
      });
    }
  });

  /* ---- contact form -> mailto ---- */
  const form = document.getElementById('contact-form');
  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const name = form.name.value.trim();
      const email = form.email.value.trim();
      const org = form.org.value.trim();
      const interest = form.interest.value;
      const message = form.message.value.trim();

      const subject = encodeURIComponent(`New inquiry from ${name || 'website visitor'}`);
      const bodyLines = [
        `Name: ${name}`,
        `Email: ${email}`,
        org ? `Organization: ${org}` : null,
        interest ? `Interested in: ${interest}` : null,
        '',
        message
      ].filter(Boolean);
      const body = encodeURIComponent(bodyLines.join('\n'));

      window.location.href = `mailto:everythingshul@gmail.com?subject=${subject}&body=${body}`;

      const success = document.querySelector('.form-success');
      if (success) success.classList.add('show');
    });
  }

});
