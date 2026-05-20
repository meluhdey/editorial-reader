const cheerio = require('cheerio');
fetch('https://harpers.org/archive/2025/11/why-doesnt-anyone-trust-the-media-jelani-cobb-taylor-lorenz-jack-shafer-max-tani-establishment-journalism/')
  .then(res => res.text())
  .then(html => {
    const $ = cheerio.load(html);
    const title = (
      $('meta[property="og:title"]').attr('content') ??
      $('meta[name="twitter:title"]').attr('content') ??
      $('h1').first().text() ??
      $('title').text()
    ).trim();
    
    const author = (
      $('meta[name="author"]').attr('content') ??
      $('meta[property="article:author"]').attr('content') ??
      $('[rel="author"]').text() ??
      $('.author, .byline').first().text() ??
      ''
    ).trim();

    console.log({ title, author });
  });
