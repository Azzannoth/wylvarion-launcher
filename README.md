# Wylvarion Launcher

Vlastní launcher pro **play.wylvarion.cz**: Minecraft **26.3 + Fabric**, automatické stažení Javy 25, hry, modů (Modrinth) a shaderů, přihlášení přes Microsoft, 3D skin, stav serveru, novinky z webu a automatické aktualizace.

Vše je zdarma: GitHub (kód + Releases + Actions), Modrinth, Mojang a Microsoft přihlášení nic nestojí.

## Co umí
- Tlačítko **HRÁT** stáhne Javu, Minecraft 26.3, Fabric a mody a rovnou připojí na server (Quick Play).
- **Mody:** povinné (Sodium, Lithium, Iris, Voice Chat…) a volitelné, které jde vypnout (minimapa, zoom…). Hráč si může přidat vlastní mody přes Modrinth nebo jako .jar.
- **Shadery** se volí automaticky podle grafiky (slabší / střední / výkonná). Jdou vypnout i ve hře klávesou K.
- **Nastavení:** RAM (s doporučením), složka hry, co dělat po spuštění.
- **Novinky** se berou z webu (`/api/launcher.php` → `includes/data/news.php`).
- **Aktualizace launcheru** přicházejí samy z GitHub Releases.

## Vzdálená konfigurace (bez vydání nové verze)
Soubor `api/launcher.php` na webu může přepsat cokoliv z `config/launcher.json`: `mods`, `server`, `links`, `shaders`, `microsoft.clientId`, `news`.

## 1) Microsoft přihlášení (jednorázově, zdarma)
Bez toho se nikdo nepřihlásí. Mojang musí schválit každou novou aplikaci.

1. Jdi na https://portal.azure.com a přihlas se libovolným Microsoft účtem. Vyhledej **App registrations** a dej **New registration**.
   - Name: `Wylvarion Launcher`
   - Supported account types: **Personal Microsoft accounts only**
   - Redirect URI: platforma **Public client/native (mobile & desktop)**, hodnota `https://login.microsoftonline.com/common/oauth2/nativeclient`
2. Po vytvoření zkopíruj **Application (client) ID**.
3. V **Authentication** zapni **Allow public client flows = Yes** a ulož.
4. Požádej Mojang o schválení formulářem: https://aka.ms/mce-reviewappid. Vyplň Client ID a popis „launcher pro náš server“. Schválení trvá obvykle pár dní až týdnů.
5. Po schválení vlož Client ID do webu, do `api/launcher.php` → `'clientId' => '...'`. Launcher si ho stáhne sám, bez nové verze.

## 2) Vydání na GitHubu (zdarma)
1. Vytvoř veřejný repozitář `Azzannoth/wylvarion-launcher` a nahraj do něj celou tuto složku (bez `node_modules` a `dist`).
2. Vytvoř tag a pushni ho, např. `git tag v1.0.0 && git push --tags`.
3. GitHub Actions samo sestaví **Windows (.exe instalátor + zip), Linux (AppImage) a macOS (dmg)** a nahraje je do Releases.
4. Pro novou verzi zvyš `version` v `package.json` a vytvoř nový tag. Hráčům se launcher aktualizuje sám.

Odkaz ke stažení na web pak bude: `https://github.com/Azzannoth/wylvarion-launcher/releases/latest`

## Upozornění
- Launcher není podepsaný (certifikát stojí peníze), takže Windows při prvním spuštění ukáže SmartScreen: **Další informace → Přesto spustit**. Na macOS: pravým tlačítkem → Otevřít.
- Hra se ukládá do `%APPDATA%\.wylvarion` (Windows), `~/Library/Application Support/wylvarion` (macOS), `~/.wylvarion` (Linux).
- Když se hra nespustí, je log v `logs/launcher-last.log`.

## Vývoj
```
npm install
npm start        # spustí launcher
npm test         # testy
npm run dist     # build pro aktuální systém
```
