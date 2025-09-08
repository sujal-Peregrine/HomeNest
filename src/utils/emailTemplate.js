export const emailLayout = ({ website_logo, heading, subheading, content }) => {
    const year = new Date().getFullYear();
    return `
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
    <title>Email Notification - HomeNest</title>
    <style>
      .footer-container { background-color: #f8fbff; padding: 25px; text-align: center; font-size: 14px; color: #666666; border-radius: 0 0 12px 12px; }
      .social-icons a { margin: 0 10px; text-decoration: none; }
      .contact-info { margin: 15px 0; }
      .contact-info p { display: inline-block; margin: 0 15px; }
      .links a { color: #3a7bd5; margin: 0 10px; text-decoration: none; }
      .content-container { padding: 0px 20px 20px 20px; line-height: 1.6; color: #333333; text-align: center; }
    </style>
  </head>
  <body>
    <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 16px; box-shadow: 0 4px 20px rgba(0,0,0,0.08); width: 100%; box-sizing: border-box;">
      <!-- Header -->
      <div style="background: linear-gradient(135deg, #3a7bd5, #00d2ff); padding: 35px 20px; text-align: center; color: white; margin-bottom: 25px;">
        <img src="https://storage.googleapis.com/mlsassistantv4/website/680b83127ca48e49fc0d6236/logo_light/NOJ6QJc43UVWStbpyDDEhNe09oJdi64fQ4c5obTs.webp" style="width: 50px; height: auto; margin-bottom: 20px;" alt="HomeNest Logo" />
        <h1 style="margin: 0; font-size: 30px; font-weight: 600;">${heading || 'Notification'}</h1>
        <p style="margin: 15px 0 0; font-size: 18px; opacity: 0.9;">${subheading || 'We’re here to assist your real estate journey'}</p>
      </div>

      <!-- Main Content -->
      <div class="content-container">
        ${content}
      </div>

      <!-- Footer -->
      <div class="footer-container">
        <div class="social-icons">
          <a href="https://facebook.com/" style="margin: 0 10px;">
            <img src="https://img.icons8.com/color/32/facebook-new.png" alt="Facebook" />
          </a>
          <a href="https://twitter.com/" style="margin: 0 10px;">
            <img src="https://img.icons8.com/color/32/twitter--v1.png" alt="Twitter" />
          </a>
          <a href="https://instagram.com/" style="margin: 0 10px;">
            <img src="https://img.icons8.com/color/32/instagram-new.png" alt="Instagram" />
          </a>
        </div>
        <div class="contact-info">
          <p style="display: inline-block; margin: 0 15px;">📞 617-782-2000</p>
          <p style="display: inline-block; margin: 0 15px;">✉️ mark@mlsassistant.com</p>
        </div>
        <p>© ${year} HomeNest. All rights reserved.</p>
        <div class="links">
          <a href="https://realcrm.pro/privacy-policy" style="color: #3a7bd5;">Privacy Policy</a> |
          <a href="https://realcrm.pro/terms" style="color: #3a7bd5;">Terms of Service</a> |
          <a href="https://realcrm.pro/unsubscribe" style="color: #3a7bd5;">Unsubscribe</a>
        </div>
      </div>
    </div>
  </body>
  </html>
    `;
  };