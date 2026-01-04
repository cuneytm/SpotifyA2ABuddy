/**
 * Spotify OAuth Yetkilendirme Yardımcısı
 * 
 * Bu script ilk kez Spotify bağlantısı kurmak için kullanılır.
 * Token'lar .spotify-tokens.json dosyasına kaydedilir.
 * 
 * Kullanım: npm run auth
 */

import express from 'express';
import open from 'open';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOKEN_FILE = path.join(__dirname, '.spotify-tokens.json');

const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
const SPOTIFY_REDIRECT_URI = process.env.SPOTIFY_REDIRECT_URI || 'http://localhost:8888/callback';
const PORT = 8888;

// Gerekli scope'lar
const SCOPES = [
  'user-read-playback-state',
  'user-modify-playback-state', 
  'user-read-currently-playing',
  'streaming',
  'playlist-read-private',
  'playlist-read-collaborative',
  'user-library-read',
  'user-top-read',
  'user-read-recently-played'
].join(' ');

// Değişkenleri kontrol et
if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET) {
  console.error('❌ Hata: SPOTIFY_CLIENT_ID ve SPOTIFY_CLIENT_SECRET .env dosyasında tanımlanmalı!');
  console.log('\n📝 Adımlar:');
  console.log('1. https://developer.spotify.com/dashboard adresine git');
  console.log('2. Yeni bir uygulama oluştur');
  console.log('3. Client ID ve Client Secret\'ı kopyala');
  console.log('4. Redirect URI olarak http://localhost:8888/callback ekle');
  console.log('5. .env dosyasını oluştur:\n');
  console.log('   SPOTIFY_CLIENT_ID=your_client_id');
  console.log('   SPOTIFY_CLIENT_SECRET=your_client_secret');
  console.log('   SPOTIFY_REDIRECT_URI=http://localhost:8888/callback');
  process.exit(1);
}

const app = express();

// Ana sayfa - yetkilendirme başlat
app.get('/', (req, res) => {
  const authUrl = new URL('https://accounts.spotify.com/authorize');
  authUrl.searchParams.set('client_id', SPOTIFY_CLIENT_ID);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('redirect_uri', SPOTIFY_REDIRECT_URI);
  authUrl.searchParams.set('scope', SCOPES);
  authUrl.searchParams.set('show_dialog', 'true');
  
  res.redirect(authUrl.toString());
});

// Callback - token al
app.get('/callback', async (req, res) => {
  const { code, error } = req.query;
  
  if (error) {
    res.send(`
      <html>
        <body style="font-family: sans-serif; padding: 40px; text-align: center;">
          <h1 style="color: #e91e63;">❌ Yetkilendirme Reddedildi</h1>
          <p>Hata: ${error}</p>
          <p>Pencereyi kapatabilirsiniz.</p>
        </body>
      </html>
    `);
    setTimeout(() => process.exit(1), 2000);
    return;
  }
  
  if (!code) {
    res.send('Kod bulunamadı');
    return;
  }
  
  try {
    // Token al
    const tokenResponse = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': 'Basic ' + Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString('base64')
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: SPOTIFY_REDIRECT_URI
      })
    });
    
    if (!tokenResponse.ok) {
      const errorData = await tokenResponse.text();
      throw new Error(`Token alma hatası: ${errorData}`);
    }
    
    const tokens = await tokenResponse.json();
    
    // Token'ları kaydet
    const tokenData = {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: Date.now() + (tokens.expires_in * 1000),
      scope: tokens.scope
    };
    
    fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokenData, null, 2));
    
    // Kullanıcı bilgisini al
    const userResponse = await fetch('https://api.spotify.com/v1/me', {
      headers: { 'Authorization': `Bearer ${tokens.access_token}` }
    });
    
    let userName = 'Kullanıcı';
    if (userResponse.ok) {
      const userData = await userResponse.json();
      userName = userData.display_name || userData.id;
    }
    
    res.send(`
      <html>
        <body style="font-family: sans-serif; padding: 40px; text-align: center; background: linear-gradient(135deg, #1a1a2e, #16213e); color: white; min-height: 100vh; margin: 0;">
          <h1 style="color: #1db954;">✅ Başarılı!</h1>
          <p style="font-size: 1.2em;">Merhaba <strong>${userName}</strong>! 🎵</p>
          <p>Spotify hesabın başarıyla bağlandı.</p>
          <p style="margin-top: 30px; color: rgba(255,255,255,0.6);">Bu pencereyi kapatabilirsin.</p>
          <p style="margin-top: 20px;">
            <code style="background: rgba(255,255,255,0.1); padding: 10px 20px; border-radius: 5px;">
              npm start
            </code>
            <br><br>
            komutu ile uygulamayı başlat!
          </p>
        </body>
      </html>
    `);
    
    console.log('\n✅ Spotify yetkilendirmesi başarılı!');
    console.log(`👤 Kullanıcı: ${userName}`);
    console.log(`📁 Token'lar kaydedildi: ${TOKEN_FILE}`);
    console.log('\n🚀 Şimdi uygulamayı başlatabilirsin: npm start\n');
    
    setTimeout(() => process.exit(0), 3000);
    
  } catch (error) {
    console.error('Token alma hatası:', error);
    res.send(`
      <html>
        <body style="font-family: sans-serif; padding: 40px; text-align: center;">
          <h1 style="color: #e91e63;">❌ Hata</h1>
          <p>${error.message}</p>
        </body>
      </html>
    `);
    setTimeout(() => process.exit(1), 2000);
  }
});

// Sunucuyu başlat
app.listen(PORT, () => {
  console.log('\n🎵 Spotify Yetkilendirme Yardımcısı\n');
  console.log('═══════════════════════════════════════\n');
  console.log(`📍 Redirect URI: ${SPOTIFY_REDIRECT_URI}`);
  console.log(`📍 Bu URI'yi Spotify Developer Dashboard'da eklediğinden emin ol!\n`);
  console.log('🌐 Tarayıcı açılıyor...\n');
  
  // Tarayıcıda aç
  open(`http://localhost:${PORT}`);
});

// Ctrl+C ile çıkış
process.on('SIGINT', () => {
  console.log('\n👋 İptal edildi.\n');
  process.exit(0);
});
