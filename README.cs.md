# HomeQuest

[English](README.md)

Hra pro děti v Home Assistantu: děti plní každodenní úkoly (vyčistit zuby, uklidit pokoj, …), dostávají za ně zlaťáky, kupují si
výbavu pro svého hrdinu a společně staví tvrz. Rodič úkoly nastavuje a schvaluje v aplikaci Home Assistant.

## Co potřebujete
- Home Assistant 2026.11 nebo novější (**Marketplace** je v něm zabudovaný; integrace sama běží od 2026.8.0).
- Pro každé dítě vlastní účet v Home Assistantu (bez práv správce): **Nastavení** → **Osoby** → **Přidat osobu**, zapnout **Povolit přihlášení**.
- Pro hraní na telefonu a notifikace aplikaci Home Assistant.
- Telefon nebo tablet s iOS 15 / iPadOS 15 nebo novějším, nebo Android s Chrome / Android System WebView 100 nebo novějším (v prohlížeči i Firefox 100+). Na starším zařízení hra místo hraní ukáže krátkou hlášku. Starší telefon, který minimum splňuje, může ukázat některé efekty jednodušeji (např. bez záře kolem vzácných věcí). Jak plynule telefon hraje: třikrát klepněte na nápis HomeQuest nahoře (i na telefonu dítěte) → **Test výkonu** (přerod tvrze a 20 s bitvy, nic se neukládá), nebo Rodič → O hře → **Test výkonu telefonu**; **Poslat** pošle čísla s hlášením problému.

## Instalace
1. **Nastavení** → **Marketplace** → vpravo nahoře **Přidat z odkazu na GitHubu** → do pole **Odkaz na GitHub** zadejte `https://github.com/eloupak/homequest-dist` → **Přidat**.
   Při prvním přidání repozitáře požádá **Marketplace** o propojení s účtem GitHub (kód zadáte na GitHubu a potvrdíte). Typ integrace pozná sám.
2. Najděte HomeQuest, nainstalujte a restartujte Home Assistant.
3. **Nastavení** → **Zařízení a služby** → **Přidat integraci** → HomeQuest.
4. V levém panelu otevřete HomeQuest a projděte průvodce: děti, jejich účty, rodiče, vaše okolí, notifikace. Pak **Spustit hru**.

Hra běží celá u vás doma, po instalaci nepotřebuje internet. Data dětí zůstávají ve vašem Home Assistantu.

## Aktualizace
Novou verzi nabídne Home Assistant v **Nastavení** → **Aktualizace** (a rodiči i HomeQuest na obrazovce Rodič); po aktualizaci restartujte Home Assistant.
Aktualizace nemění rozehranou hru ani vaše nastavení.

Chcete zkoušet nové verze dřív? **Nastavení** → **Zařízení a služby** → **Marketplace** → zařízení HomeQuest: entita **Předběžné vydání** je ve výchozím stavu
vypnutá, nejdřív ji povolte a pak přepínač zapněte. Bety mohou obsahovat chyby. Před aktualizací si udělejte zálohu Home Assistantu;
k předchozí verzi se po aktualizaci vracejte obnovením zálohy, ne instalací starší verze.

## Licence
HomeQuest (kód i grafika) je pod licencí [CC BY-NC-ND 4.0](LICENSE): smíte ho zdarma instalovat a používat pro soukromé účely.
Nesmíte ho upravovat, šířit upravené verze ani používat komerčně. Písma Alegreya SC a Nunito jsou pod licencí SIL Open Font
License (`LICENSE-fonts/`).
