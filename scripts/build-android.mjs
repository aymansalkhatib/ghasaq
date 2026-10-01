/*
 * Builds the Android app: release/Ghasaq-<version>.apk
 *
 *   npm run build:apk
 *
 * 1. the single-file game with its fonts inside (dist-app/ghasaq.html)
 * 2. copied into the Android project as assets/index.html
 * 3. Gradle builds the release APK, signed with android/keystore/ghasaq-release.jks
 * Needs a JDK 17+ (JAVA_HOME, or Android Studio's bundled one) and the Android SDK (android/local.properties).
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const version = JSON.parse(readFileSync('package.json', 'utf8')).version;

execFileSync(process.execPath, ['scripts/build-single.mjs', '--app'], { stdio: 'inherit' });
mkdirSync('android/app/src/main/assets', { recursive: true });
copyFileSync('dist-app/ghasaq.html', 'android/app/src/main/assets/index.html');

const env = { ...process.env };
if (!env.JAVA_HOME || !existsSync(env.JAVA_HOME)) {
  const jbr = 'C:/Program Files/Android/Android Studio/jbr';
  if (existsSync(jbr)) env.JAVA_HOME = jbr;
}
const win = process.platform === 'win32';
// full path: some shells refuse to run programs from the current folder by bare name
const gradlew = join(root, 'android', win ? 'gradlew.bat' : 'gradlew');
execFileSync(win ? 'cmd.exe' : gradlew, win ? ['/c', gradlew, 'assembleRelease', '--no-daemon'] : ['assembleRelease', '--no-daemon'],
  { cwd: join(root, 'android'), stdio: 'inherit', env });

const apk = 'android/app/build/outputs/apk/release/app-release.apk';
if (!existsSync(apk)) throw new Error('Gradle finished without producing ' + apk);
mkdirSync('release', { recursive: true });
const out = `release/Ghasaq-${version}.apk`;
copyFileSync(apk, out);
console.log('\n' + out);
