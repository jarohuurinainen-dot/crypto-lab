# Crypto Lab: kryptostrategioiden testaus ja paperitreidaus

Tällä selvitetään **ennen kuin oikeaa rahaa laitetaan**, voittaako mikään strategia osta ja pidä -sijoittamisen.

## Mitä tässä on

- **8 strategiaa + vertailukohta:** liukuvien keskiarvojen risteys, EMA-trendi ATR-stopilla, Donchian-läpimurto, RSI-notkahdukset, Bollinger-kaista, momentti, trendi + volatiliteettitavoite sekä MACD.
- **Rehellinen testi:**
  - Kaupat tehdään vasta seuraavan kynttilän avauksessa, joten tulevaisuuteen ei kurkata. Tämä on testattu automaattisesti.
  - Kulut ovat 0,15 % per kauppa.
  - Walk-forward-testissä parametrit valitaan 2 vuoden datalla ja testataan seuraavalla 6 kuukaudella, jota strategia ei ole nähnyt. Sen jälkeen ikkunaa siirretään eteenpäin.
- **5 kolikkoa × 2 aikaväliä:** BTC, ETH, SOL, BNB ja XRP, päivä- ja 4 tunnin kynttilöillä. Strategia on uskottava vasta, kun se toimii useimmissa niistä eikä vain yhdessä.
- **Paperitreidausbotti:** virtuaaliset 1 000 $ per strategia. Botti pyörii GitHub Actionsissa ilmaiseksi kerran päivässä, ja tulokset näkyvät verkkosivuna.

## Omalla koneella

```
npm test           # 11 testiä
npm run data       # lataa hintahistorian Binancesta (ilmainen, ei tiliä) - noin 2 min
npm run backtest   # vertailu, raportti: reports/report.html
npm run demo       # sama keinotekoisella datalla (koneiston testaus)
```

## Paperitreidaus GitHubiin (kerran, noin 15 min)

1. Tee tili osoitteessa github.com (13+ vuotta riittää).
2. Asenna **GitHub Desktop** (desktop.github.com) ja kirjaudu sisään.
3. Valitse GitHub Desktopissa *File → Add local repository* ja kansio `crypto-lab`. Kun ohjelma kysyy, valitse *create a repository*.
4. Valitse *Publish repository*. Poista rasti kohdasta *Keep this code private*, koska GitHub Pages on ilmainen vain julkisille repoille. Jos haluat repon yksityiseksi, botti toimii silti, mutta sivu ei näy.
5. Aja botti ensimmäisen kerran käsin kohdassa *Actions → Paperitreidaus → Run workflow*. Jos ajo kaatuu git push -vaiheessa, laita *Settings → Actions → General → Workflow permissions → Read and write permissions* päälle ja aja uudelleen.
6. Ota sivu käyttöön kohdassa *Settings → Pages → Source: Deploy from a branch → Branch: main, folder: /docs → Save*.
7. Tulokset näkyvät osoitteessa `https://<käyttäjänimesi>.github.io/crypto-lab/`, ja ne päivittyvät joka yö.

Kun oikea backtest on ajettu, kopioi `paper/config.suggested.json` tiedoston `paper/config.json` päälle. Silloin botti käyttää backtestin parhaita strategioita.

## Rehellisesti

- Valtaosa strategioista häviää osta ja pidä -sijoittamiselle kulujen jälkeen. Se on normaalia, ja juuri sen takia testataan.
- Paras mahdollinen tulos ei yleensä ole suurempi tuotto. Se on **pienempi pudotus** samalla tuotolla: krypto voi pudota 70–90 %, ja trendisuodatin voi välttää osan siitä.
- Oikeaa rahaa vasta, kun strategia on voittanut sekä backtestissä että vähintään 3 kuukautta paperilla. Silloinkin vain summalla, jonka menettämisen kestää.
