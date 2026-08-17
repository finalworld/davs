# Davina & Jimmy – Spenatstorm, lokal v4

Öppna `index.html` direkt i webbläsaren. Ingen server, Node.js eller installation behövs.

## Ändringar i v4

- Starkare uppgraderingar med större procentuella förbättringar.
- "Projektilfest" ger två extra projektiler per val.
- Nya förbättringar för genomslag och kritiska träffar.
- Davina startar med två projektiler och något bättre grundskada.
- Små läkande spenatbitar dyker upp slumpmässigt i världen. Plocka upp dem för att få tillbaka ork.
- När Den farliga Kayvan kommer försvinner merparten av småfienderna och nya småfiender kommer mycket långsammare tills Kayvan är besegrad.
- Kayvan har justerats ned något i hälsa och skada, särskilt första gången.
- Den vanliga fiendekurvan är något lugnare och maxmängden fiender har sänkts.

Topplistan sparas lokalt i webbläsarens localStorage på den enhet där spelet körs.


## v5 – monster per minut
Varje hel minut börjar en ny monsterfamilj spawna med nytt utseende. Fiender som redan finns på planen behåller sin gamla typ tills de besegras. Senare minuter ger försiktigt mer hälsa, skada, fart och större grupper. Från minut 3 kan vissa monster skjuta långsamma projektiler. Kayvan-reglerna som tunnar ut småfiender under bosskamp finns kvar.


## v7 – mobil HUD
HUD:en är flyttad till toppen och gjord betydligt mindre. Hälsa, nivå, tid, besegrade, erfarenhet och Jimmy ligger i en kompakt toppanel. Paus, ljud och fullskärm har tydligare knappar. Alla korta spelmeddelanden visas precis under HUD:en. Nedre delen av skärmen lämnas fri för den virtuella styrspaken.


## v8 – desktopfix
Desktop-HUD:en hålls nu kompakt och centrerad högst upp. Mobil-HUD:en är oförändrad och styrspaken visas bara på pekskärm/mobil.


## v16 – zoom
Spelet har nu +/−-knappar längst ner i hörnet mittemot mobilens styrspak. Kameran kan zoomas ut till 50 %, vilket ger ungefär dubbelt så stort synfält som standardläget 100 %. Den kan också zoomas in till 125 %. På pekskärm fungerar tvåfingers-nypning direkt på spelplanen. Zoomknapparna kan döljas i Inställningar och zoomnivå, knappvisning och styrspakssida sparas lokalt.


## v20 – stor uppdatering
- Dator: Diablo-inspirerad HUD längst ner med HP-klot vänster och gult XP-klot höger. Mobil behåller topp-HUD.
- Gult reserveras för XP; gula monster och fiendeskott är borttagna.
- Sex lugna pastellbakgrunder slumpas per ny runda.
- Vanliga monster är cirka 50 % större.
- Den farliga Kayvan är dubbelt så stor, har 3× tidigare HP, 2× XP och läker upp till 20 HP när han besegras. Han ritas som gammal gubbe med rullator och cigarr.
- APPZ THE MIGHTY kommer 10:00, 20:00, 30:00 osv. Han är en enorm gorilla med käpp och har 4× den uppgraderade Kayvans HP.
- Minutmeddelandet visar rätt minut.
- Spawnlogiken är robust för rundor över 10 minuter och fortsätter oändligt.
- Jätteprojektiler ger nu 70 % större projektiler per val så skillnaden syns tydligt.
- Zoomkontrollerna använder en separat synlighetsklass så +/− kan visas/döljas korrekt.
- Världstopplistan via Turso är kvar.

## v21
Dubbelt mobtryck och nya aktiva skills: Chain Lightning, Shockvåg, Jimmy Zoomies, ONE STORM, Jimmy Attack, Emergency Chicken, Poop Mines. Ny passiv Instabil Spenat. Grundprojektilerna är alltid kvar.

## v22 – gräsfält, synliga skills och monster
- Den bifogade gräsbilden används som sömlös tile i en oändlig värld.
- Monster spawnar betydligt närmare den synliga spelplanen.
- Åtta tydligt olika monster-silhuetter ersätter enkla geometriska former.
- Jimmy Zoomies och Jimmy Attack flyttar nu Jimmy synligt.
- Chain Lightning ritas som en tydlig lila/vit zigzag-blixt.
- Skill-effekter har starkare kontrast mot gräsbakgrunden och fler ljudeffekter.
- Dubbelt mobtryck och alla v21-skills är kvar.


## v23 – mer monster, collision, dash och ordentligt oväsen
- Spawnfrekvensen är ungefär dubblerad på riktigt, inte bara teoretiskt.
- Fiender spawnar runt Davinas aktuella position och en watchdog kastar in nya pack om planen blir tom.
- Mobs får spawn-separation och mjuk collision via spatial grid så de inte ligger staplade i varandra.
- Davina kolliderar normalt med mobs men Dash går igenom dem.
- Dash: Space på dator, stor halvtransparent knapp på motsatt sida från styrspaken på mobil. 2 laddningar, 4 sek/laddning.
- Zoomknappar är av som standard och ligger ovanför Dash när de aktiveras.
- Kayvan/Appz har mycket tydligare bossnamn.
- Nytt Web Audio-ljudsystem med tydligare ljud för skott, träffar, crit, XP, healing, level-up, skills, Jimmy, explosioner, bossar, dash, skada och game over.
- Det dumma, svordomskomiska språket är tillbaka i instruktioner och världstopplista.


## v24 – tydligare nivåval, tomater och inga fejkförsvunna monster
- Varje skillkort visar exakt vad nästa nivå ger, med faktiska siffror där det går.
- Killstatistiken heter nu Monsterjävlar.
- Levande monster kapas inte längre bort av den gamla 260-fiendersgränsen; detta var en trolig orsak till att synliga monster försvann utan att ge kills.
- Kayvan och APPZ despawnar inte längre vanliga mobs när de dyker upp.
- Healing på marken är nu tydliga röda tomater med ljus outline.
