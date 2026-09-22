const crypto = require('crypto');
const { Client } = require('pg');
const readline = require('readline');

const username = 'redmoon.owner1';
const name = 'Red Moon Owner';
const nickname = 'Owner';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

rl.question('Add meg az uj Owner jelszavat: ', async (password) => {
  if (!password || password.length < 8) {
    console.error('A jelszo legyen legalabb 8 karakter.');
    rl.close();
    return;
  }

  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto
    .pbkdf2Sync(password, salt, 310000, 32, 'sha256')
    .toString('hex');

  const passwordHash = `PBKDF2:310000:sha256:${salt}:${hash}`;

  const client = new Client({
    connectionString: process.env.DATABASE_URL
  });

  try {
    await client.connect();

    const result = await client.query(
      'SELECT data FROM red_moon_state WHERE id = 1'
    );

    if (!result.rows.length) {
      throw new Error('A red_moon_state rekord nem talalhato.');
    }

    const data = result.rows[0].data;
    data.users = Array.isArray(data.users) ? data.users : [];

    if (data.users.some(u =>
      String(u.username || '').toLowerCase() === username.toLowerCase()
    )) {
      throw new Error('Ez a felhasznalonev mar letezik.');
    }

    data.users.push({
      id: 'u_owner_' + crypto.randomBytes(6).toString('hex'),
      name,
      nickname,
      username,
      role: 'owner',
      portal: 'staff',
      passwordHash
    });

    await client.query(
      'UPDATE red_moon_state SET data = $1 WHERE id = 1',
      [data]
    );

    console.log('');
    console.log('OWNER FIOK LETREHOZVA');
    console.log('Felhasznalonev: ' + username);
    console.log('Nev: ' + name);
    console.log('Szerepkor: owner');

  } catch (err) {
    console.error('HIBA:', err.message);
  } finally {
    await client.end().catch(() => {});
    rl.close();
  }
});