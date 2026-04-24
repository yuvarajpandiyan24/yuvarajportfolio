/**
 * ═══════════════════════════════════════════════════════════
 *  yuvaraj-portfolio-bridge.js
 *  Add this script to your portfolio's index.html
 *  It connects your portfolio to yuva.admin panel
 * ═══════════════════════════════════════════════════════════
 *
 *  HOW TO USE:
 *  1. Add this to your portfolio's index.html before </body>:
 *     <script src="yuvaraj-portfolio-bridge.js"></script>
 *
 *  2. In your contact form's submit handler, call:
 *     submitToAdmin(name, email, subject, message)
 *
 *  3. To show published blog posts:
 *     const posts = getAdminBlogs();
 *
 *  4. To get any section data:
 *     const projects = getAdminSection('works');
 *     const skills   = getAdminSection('techstack');
 *     const edu      = getAdminSection('study');
 */

(function () {
  var PREFIX = 'ypa_'; // Must match STORAGE_PREFIX in admin panel

  /** Read data stored by admin panel */
  function getAdminData(key) {
    try {
      return JSON.parse(localStorage.getItem(PREFIX + key) || '[]');
    } catch (e) {
      return [];
    }
  }

  /**
   * Submit a contact form message to admin inbox
   * @param {string} name     - Sender's name
   * @param {string} email    - Sender's email
   * @param {string} subject  - Message subject
   * @param {string} msg      - Message body
   * @returns {boolean} true on success
   */
  window.submitToAdmin = function (name, email, subject, msg) {
    try {
      var items = getAdminData('contact');
      var entry = {
        id: 'id_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
        name: String(name || '').trim(),
        email: String(email || '').trim(),
        subject: String(subject || '').trim(),
        msg: String(msg || '').trim(),
        read: false,
        createdAt: new Date().toISOString(),
      };
      items.push(entry);
      localStorage.setItem(PREFIX + 'contact', JSON.stringify(items));

      // Notify admin panel if open in another tab on same domain
      try {
        window.dispatchEvent(
          new StorageEvent('storage', {
            key: PREFIX + 'contact',
            newValue: JSON.stringify(items),
            storageArea: localStorage,
          })
        );
      } catch (e) {}

      return true;
    } catch (e) {
      console.error('submitToAdmin error:', e);
      return false;
    }
  };

  /**
   * Get published blog posts (sorted newest first)
   * @returns {Array} array of blog post objects
   */
  window.getAdminBlogs = function () {
    return getAdminData('blog')
      .filter(function (b) { return b.status === 'published'; })
      .sort(function (a, b) {
        return new Date(b.createdAt) - new Date(a.createdAt);
      });
  };

  /**
   * Get any section's data
   * Keys: 'works' | 'experience' | 'study' | 'techstack' |
   *       'problemsolving' | 'wip' | 'blog' | 'contact'
   * @param {string} key
   * @returns {Array}
   */
  window.getAdminSection = function (key) {
    return getAdminData(key);
  };

  // Signal that bridge is ready
  window.adminDataReady = true;
  window.dispatchEvent(new Event('adminReady'));

  console.log('%c yuva.admin bridge ready ', 'background:#7c6fff;color:#fff;border-radius:4px;padding:2px 6px;font-weight:bold');
})();

/* ═══════════════════════════════════════════════════════════
   EXAMPLE: How to wire up your portfolio contact form
   ─────────────────────────────────────────────────────────
   Replace YOUR form's submit handler with something like:

   document.querySelector('#contact-form').addEventListener('submit', function(e) {
     e.preventDefault();
     var name    = document.querySelector('#name').value;
     var email   = document.querySelector('#email').value;
     var subject = document.querySelector('#subject').value;
     var message = document.querySelector('#message').value;

     var success = submitToAdmin(name, email, subject, message);
     if (success) {
       alert('Message sent! I will get back to you soon.');
       e.target.reset();
     } else {
       alert('Something went wrong. Please email me directly.');
     }
   });

   ─────────────────────────────────────────────────────────
   EXAMPLE: Render blog posts in your portfolio

   window.addEventListener('adminReady', function() {
     var posts = getAdminBlogs();
     var html = posts.map(function(p) {
       return '<article>' +
         '<h3>' + p.title + '</h3>' +
         '<p>' + (p.tags || '') + '</p>' +
         '<p>' + new Date(p.createdAt).toLocaleDateString() + '</p>' +
         '<p>' + p.content + '</p>' +
         '</article>';
     }).join('');
     document.querySelector('#blog-section').innerHTML = html || '<p>No posts yet.</p>';
   });
═══════════════════════════════════════════════════════════ */
