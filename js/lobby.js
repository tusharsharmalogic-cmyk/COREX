// ============================================
// COREX - Lobby (name + mode + options)
// Saves player name to localStorage
// ============================================

const LOBBY_KEY = 'corex_player_name';

const Lobby = {
  onStart: null,   // callback(config)
  name: '',

  init() {
    this.el           = document.getElementById('lobby-overlay');
    this.panelMain    = document.getElementById('lobby-main');
    this.panelDM      = document.getElementById('lobby-deathmatch');
    this.panelTime    = document.getElementById('lobby-time');
    this.panelBots    = document.getElementById('lobby-bots');

    this.nameInput    = document.getElementById('lobby-name');
    this.btnPlay      = document.getElementById('lobby-play');
    this.btnDM        = document.getElementById('lobby-dm');
    this.btnTime      = document.getElementById('lobby-time-btn');
    this.btnLast      = document.getElementById('lobby-last-btn');
    this.timeInput    = document.getElementById('lobby-time-min');
    this.botInput     = document.getElementById('lobby-bot-count');
    this.btnBotsStart = document.getElementById('lobby-start-btn');
    this.btnBackDM    = document.getElementById('lobby-back-dm');
    this.btnBackTime  = document.getElementById('lobby-back-time');
    this.btnBackBots  = document.getElementById('lobby-back-bots');
    this.timeModeLabel= document.getElementById('lobby-time-mode-label');

    // Load saved name
    const saved = localStorage.getItem(LOBBY_KEY) || '';
    this.nameInput.value = saved;

    this.btnPlay.addEventListener('click', () => {
      const v = (this.nameInput.value || '').trim();
      if (v.length < 2) { this.nameInput.style.borderColor = '#e74c3c'; return; }
      this.name = v;
      localStorage.setItem(LOBBY_KEY, v);
      this.show(this.panelDM);
    });

    this.btnDM.addEventListener('click', () => {
      // Deathmatch selected -> ask time or last-standing
      this.show(this.panelTime);
    });

    this.btnTime.addEventListener('click', () => {
      this._timeMode = 'timed';
      this.timeModeLabel.innerText = 'TIME (min)';
      this.timeInput.style.display = 'block';
      this.show(this.panelBots);
    });

    this.btnLast.addEventListener('click', () => {
      this._timeMode = 'last';
      this.timeModeLabel.innerText = 'LAST STANDING';
      this.timeInput.style.display = 'none';
      this.show(this.panelBots);
    });

    this.btnBotsStart.addEventListener('click', () => {
      let bots = parseInt(this.botInput.value, 10);
      if (isNaN(bots)) bots = 8;
      bots = Math.max(1, Math.min(10, bots));

      let minutes = 5;
      if (this._timeMode === 'timed') {
        minutes = parseInt(this.timeInput.value, 10);
        if (isNaN(minutes) || minutes < 1) minutes = 5;
        minutes = Math.min(30, minutes);
      }

      this.el.classList.remove('open');
      if (this.onStart) {
        this.onStart({
          name: this.name,
          mode: 'deathmatch',
          dmMode: this._timeMode,
          timeLimitMin: minutes,
          botCount: bots,
        });
      }
    });

    this.btnBackDM.addEventListener('click',   () => this.show(this.panelMain));
    this.btnBackTime.addEventListener('click', () => this.show(this.panelDM));
    this.btnBackBots.addEventListener('click', () => this.show(this.panelTime));

    this.show(this.panelMain);
  },

  show(panel) {
    this.el.classList.add('open');
    [this.panelMain, this.panelDM, this.panelTime, this.panelBots]
      .forEach(p => { if (p) p.style.display = 'none'; });
    panel.style.display = 'block';
  },

  hide() { this.el.classList.remove('open'); },
};

window.Lobby = Lobby;