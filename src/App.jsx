// App.jsx
import React, { useState, useEffect, useRef } from 'react';
import { supabase } from './supabase/client';
import * as XLSX from 'xlsx';
import MD5 from 'crypto-js/md5';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import {
  Document,
  Packer,
  Paragraph,
  Table,
  TableRow,
  TableCell,
  TextRun,
  HeadingLevel,
  AlignmentType,
  WidthType,
} from "docx";

function App() {
  // ================== KONSTANTY / UI STAVY ================== VÍCE v README.md 
  const passwordHash = '312351bff07989769097660a56395065'; // MD5("2025")
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [userPasswordInput, setUserPasswordInput] = useState('');
  const passwordRef = useRef(null);
  const [isPasswordPrompt, setIsPasswordPrompt] = useState(false);
  const [passwordError, setPasswordError] = useState('');

  const [players, setPlayers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdate, setLastUpdate] = useState(localStorage.getItem('lastUpdate') || new Date().toLocaleString());
  const [filterOddil, setFilterOddil] = useState('Všichni');
  const [sortKey, setSortKey] = useState(null);
  const [sortAsc, setSortAsc] = useState(true);
  const [formData, setFormData] = useState({
    hrac: '',
    oddil: '',
    uspesnost: '',
    ucast: '',
    elo: '',
    turnaje: 0,
    uroven: 1,
  });
  const [editingPlayerId, setEditingPlayerId] = useState(null);

  const [jsonFile, setJsonFile] = useState(null);
  const jsonInputRef = useRef(null);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalTitle, setModalTitle] = useState('');
  const [modalMessage, setModalMessage] = useState('');
  const [modalConfirmCallback, setModalConfirmCallback] = useState(null);

  const [showScrollToTopButton, setShowScrollToTopButton] = useState(false);
  const [showScrollToBottomButton, setShowScrollToBottomButton] = useState(false);

  const [weatherData, setWeatherData] = useState(null);
  const [weatherError, setWeatherError] = useState(null);

  const [searchQuery, setSearchQuery] = useState('');
  const PAGE_SIZE = 1000; // Supabase vrací max ~1000 řádků na 1 dotaz

  // ====== STYLY PRO ZÁLOHOVACÍ TLAČÍTKA (úpravy klidně jen zde) ======
  const commonFullWidthBtn = {
    display: 'block',
    width: '100%',
    margin: '10px 0',
    padding: '10px 16px',
    borderRadius: '10px',
    border: 'none',
    cursor: 'pointer',
    fontSize: '0.9rem',
    fontWeight: 400, // NE tučně
  };

  // Zelené tlačítko – stejné „pocitově“ jako ostatní
  const backupBtnStyle = {
    ...commonFullWidthBtn,
    background: '#2e7d32',
    color: '#fff',
  };

  // Oranžové tlačítko – text si nechám černý, jako u „Export JSON“
  const backupZipBtnStyle = {
    ...commonFullWidthBtn,
    background: '#f39c12',
    color: '#000',
  };

  // ================== HELPERY ==================
  useEffect(() => {
    if (sessionStorage.getItem('auth') === '1') setIsAuthenticated(true);
  }, []);

  const generateId = () => {
    // jednoduché lidské ID (vyhoví NOT NULL)
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  };

  const calculatePlayerBody = (player) => {
    const turnajeValue = player.turnaje === null || isNaN(player.turnaje) ? 0 : player.turnaje;
    let ko = 0.6;
    if (player.ucast > 20) ko = 0.8;
    if (player.ucast > 40) ko = 1;
    if (player.ucast > 60) ko = 1.2;
    if (player.ucast > 80) ko = 1.4;

    const ks = [1, 1.4, 1.96, 2.744, 3.8416, 5.3782, 7.5295, 10.5413, 14.7579];
    const urovIndex = Math.max(0, Math.min(8, player.urov - 1));
    return player.usp * 100 * ko * ks[urovIndex] + player.elo / 2 + turnajeValue;
  };

  const bracketForRank = (rank) => {
    if (rank <= 10) return rank;
    if (rank <= 20) return 15;
    if (rank <= 30) return 25;

    const groupSizes = [20,20,20, 30,30,30, 40,40,40, 50,50,50, 60,60,60];
    let start = 31;
    for (let size of groupSizes) {
      const end = start + size - 1;
      if (rank >= start && rank <= end) {
        return Math.round((start + end) / 2);
      }
      start = end + 1;
    }
    const span = 60;
    let blockIndex = Math.floor((rank - start) / span);
    const blockStart = start + blockIndex * span;
    const blockEnd = blockStart + span - 1;
    return Math.round((blockStart + blockEnd) / 2);
  };

  const updateGlobalRanks = (currentPlayers) => {
    const sortedPlayers = [...currentPlayers].sort((a, b) => {
      const bodyA = a.body === null || isNaN(a.body) ? -Infinity : a.body;
      const bodyB = b.body === null || isNaN(b.body) ? -Infinity : b.body;
      return bodyB - bodyA;
    });
    return sortedPlayers.map((p, i) => {
      const rank = i + 1;
      const bracket = bracketForRank(rank);
      return { ...p, rank, bracket };
    });
  };

  // ================== MODAL ==================
  const showModal = (title, message, onConfirm = null, showPasswordInput = false) => {
    setModalTitle(title);
    setModalMessage(message);
    setModalConfirmCallback(() => onConfirm);
    setIsPasswordPrompt(showPasswordInput);
    setPasswordError('');
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setModalTitle('');
    setModalMessage('');
    setModalConfirmCallback(null);
    setIsPasswordPrompt(false);
    setUserPasswordInput('');
    setPasswordError('');
  };

  const checkPassword = () => {
    const entered = (passwordRef.current?.value ?? userPasswordInput ?? '').trim();
    const enteredHash = MD5(entered).toString();
    return enteredHash === passwordHash;
  };

  // ================== DATA FETCH ==================
  // POZOR: range(0, 19999) je „od–do (včetně)“. Můžu menší/větší číslo. Alternativa je .limit(20000).
  const fetchPlayers = async () => {
  setLoading(true);

  let from = 0;
  let all = [];

  while (true) {
    const { data, error } = await supabase
      .from('players')
      .select('*')
      .order('body', { ascending: false })
      .range(from, from + PAGE_SIZE - 1); // 0–999, 1000–1999, ...

    if (error) {
      setError(error);
      console.error('Chyba při načítání dat z Supabase:', error);
      showModal('Chyba načítání', 'Nepodařilo se načíst data z databáze.');
      setLoading(false);
      return;
    }

    all = all.concat(data || []);
    if (!data || data.length < PAGE_SIZE) break; // poslední stránka
    from += PAGE_SIZE;
  }

  const playersWithCalculatedBody = all.map(p => {
    const playerWithBody = { ...p };
    if (p.body === null || p.body === undefined || isNaN(p.body)) {
      playerWithBody.body = calculatePlayerBody(p);
    }
    return playerWithBody;
  });

  const rankedPlayers = updateGlobalRanks(playersWithCalculatedBody);
  setPlayers(rankedPlayers);
  setLastUpdate(new Date().toLocaleString());
  setLoading(false);
};



  useEffect(() => {
    fetchPlayers();
  }, []);

  // ================== POČASÍ (volitelné) ==================
  useEffect(() => {
    const apiKey = '784c3d093fe258dbf492d1a14638e119';
    const city = 'Nová Pec';
    const units = 'metric';
    async function fetchWeather() {
      if (!apiKey) {
        setWeatherError('API klíč pro počasí chybí.');
        return;
      }
      const url = `https://api.openweathermap.org/data/2.5/weather?q=${city}&appid=${apiKey}&units=${units}&lang=cz`;
      try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const data = await response.json();
        const temperature = Math.round(data.main.temp);
        const weatherIconCode = data.weather[0].icon;
        const weatherDescription = data.weather[0].description;
        let iconSymbol = '';
        if (weatherIconCode.startsWith('01')) iconSymbol = '☀️';
        else if (weatherIconCode.startsWith('02')) iconSymbol = '🌤️';
        else if (weatherIconCode.startsWith('03')) iconSymbol = '☁️';
        else if (weatherIconCode.startsWith('04')) iconSymbol = '☁️';
        else if (weatherIconCode.startsWith('09')) iconSymbol = '🌧️';
        else if (weatherIconCode.startsWith('10')) iconSymbol = '🌧️';
        else if (weatherIconCode.startsWith('11')) iconSymbol = '⛈️';
        else if (weatherIconCode.startsWith('13')) iconSymbol = '❄️';
        else if (weatherIconCode.startsWith('50')) iconSymbol = '🌫️';
        else iconSymbol = '🌐';
        setWeatherData({ temperature, icon: iconSymbol, description: weatherDescription });
        setWeatherError(null);
      } catch (error) {
        setWeatherError('Počasí n/a');
        console.error('Nepodařilo se načíst data o počasí:', error);
      }
    }
    fetchWeather();
    const intervalId = setInterval(fetchWeather, 600000);
    return () => clearInterval(intervalId);
  }, []);

  // ================== UI: ŠIPKY ==================
  useEffect(() => {
    const handleScrollVisibility = () => {
      const isPageScrollable = document.documentElement.scrollHeight > window.innerHeight;
      const isAtBottom = (window.innerHeight + window.pageYOffset) >= (document.documentElement.scrollHeight - 200);
      setShowScrollToBottomButton(isPageScrollable && !isAtBottom);
      setShowScrollToTopButton(window.pageYOffset > 200);
    };
    window.addEventListener('scroll', handleScrollVisibility);
    handleScrollVisibility();
    return () => window.removeEventListener('scroll', handleScrollVisibility);
  }, []);

  // ================== FORMULÁŘ ==================
  const handleFormChange = (e) => {
    const { id, value } = e.target;
    setFormData(prevData => ({
      ...prevData,
      [id]: id === 'uspesnost' || id === 'ucast' || id === 'elo' || id === 'turnaje' || id === 'uroven'
        ? Number(value)
        : value,
    }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (isAuthenticated) {
      performSubmit();
    } else {
      showModal(
        'Zadejte heslo',
        'Pro uložení změn zadejte heslo:',
        () => {
          if (checkPassword()) {
            setIsAuthenticated(true);
            sessionStorage.setItem('auth', '1');
            performSubmit();
            closeModal();
          } else {
            setPasswordError('Máte špatné heslo.');
            if (passwordRef.current) {
              passwordRef.current.value = '';
              setUserPasswordInput('');
              passwordRef.current.focus();
            }
          }
        },
        true
      );
    }
  };

  // CREATE/UPDATE hráče – při INSERTU **posílám i id: generateId()**
  const performSubmit = async () => {
    const payload = {
      name: formData.hrac,
      oddil: formData.oddil,
      usp: formData.uspesnost / 100,
      ucast: formData.ucast,
      elo: formData.elo,
      turnaje: formData.turnaje,
      urov: formData.uroven,
    };
    payload.body = calculatePlayerBody(payload);

    let dbResponse;
    if (editingPlayerId) {
      dbResponse = await supabase
        .from('players')
        .update(payload)
        .eq('id', editingPlayerId);
    } else {
      dbResponse = await supabase
        .from('players')
        .insert([{ id: generateId(), ...payload }]); // <<< tady přidávám id
    }

    if (dbResponse.error) {
      showModal('Chyba databáze', `Nepodařilo se uložit data: ${dbResponse.error.message}`);
    } else {
      fetchPlayers();
      setFormData({ hrac: '', oddil: '', uspesnost: '', ucast: '', elo: '', turnaje: 0, uroven: 1 });
      setEditingPlayerId(null);
    }
  };

  // ================== EDIT/DELETE ==================
  const handleFilterChange = (e) => setFilterOddil(e.target.value);

  const handleSort = (key) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(true); }
  };

  const handleEditPlayer = (playerId) => {
    if (isAuthenticated) {
      const playerToEdit = players.find(p => p.id === playerId);
      if (playerToEdit) {
        setFormData({
          hrac: playerToEdit.name,
          oddil: playerToEdit.oddil,
          uspesnost: playerToEdit.usp * 100,
          ucast: playerToEdit.ucast,
          elo: playerToEdit.elo,
          turnaje: playerToEdit.turnaje,
          uroven: playerToEdit.urov,
        });
        setEditingPlayerId(playerId);
        document.getElementById('zebricek-form').scrollIntoView({ behavior: 'smooth' });
      }
    } else {
      showModal(
        'Zadejte heslo',
        'Pro úpravu hráče zadejte heslo:',
        () => {
          if (checkPassword()) {
            setIsAuthenticated(true);
            sessionStorage.setItem('auth', '1');
            const playerToEdit = players.find(p => p.id === playerId);
            if (playerToEdit) {
              setFormData({
                hrac: playerToEdit.name,
                oddil: playerToEdit.oddil,
                uspesnost: playerToEdit.usp * 100,
                ucast: playerToEdit.ucast,
                elo: playerToEdit.elo,
                turnaje: playerToEdit.turnaje,
                uroven: playerToEdit.urov,
              });
              setEditingPlayerId(playerId);
              document.getElementById('zebricek-form').scrollIntoView({ behavior: 'smooth' });
            }
            closeModal();
          } else {
            setPasswordError('Máte špatné heslo.');
            if (passwordRef.current) {
              passwordRef.current.value = '';
              setUserPasswordInput('');
              passwordRef.current.focus();
            }
          }
        },
        true
      );
    }
  };

  const handleDeletePlayer = (playerId, playerName) => {
    if (isAuthenticated) {
      performDelete(playerId, playerName);
    } else {
      showModal(
        'Zadejte heslo',
        `Pro smazání hráče ${playerName} zadejte heslo:`,
        () => {
          if (checkPassword()) {
            setIsAuthenticated(true);
            sessionStorage.setItem('auth', '1');
            performDelete(playerId, playerName);
            closeModal();
          } else {
            setPasswordError('Máte špatné heslo.');
            if (passwordRef.current) {
              passwordRef.current.value = '';
              setUserPasswordInput('');
              passwordRef.current.focus();
            }
          }
        },
        true
      );
    }
  };

  const performDelete = async (playerId, playerName) => {
  showModal(
    'Potvrzení smazání',
    `Opravdu smazat hráče ${playerName}?`,
    async () => {
      // Zavřít dialog okamžitě po "Ano"
      closeModal();

      const { error } = await supabase
        .from('players')
        .delete()
        .eq('id', playerId); // žádné normalizeIdForQuery – neexistuje

      if (error) {
        showModal('Chyba databáze', `Nepodařilo se smazat hráče: ${error.message}`);
      } else {
        await fetchPlayers();
      }
    }
  );
};


  const handleDeleteAll = () => {
  const reallyDelete = async () => {
    // zavřít dialog hned po potvrzení
    closeModal();
      const { error } = await supabase.from('players').delete().neq('id', '');
      if (error) showModal('Chyba databáze', `Nepodařilo se smazat všechna data: ${error.message}`);
      else { fetchPlayers(); showModal('Hotovo', 'Všechna data byla smazána.'); }
    };

    if (isAuthenticated) {
      showModal('Smazat všechno?', 'Opravdu smazat VŠECHNY hráče? To nelze vrátit zpět.', reallyDelete);
    } else {
      showModal(
        'Zadejte heslo',
        'Pro smazání všech hráčů zadejte heslo:',
        () => {
          if (checkPassword()) {
            setIsAuthenticated(true);
            sessionStorage.setItem('auth', '1');
            closeModal();
            showModal('Smazat všechno?', 'Opravdu smazat VŠECHNY hráče? To nelze vrátit zpět.', reallyDelete);
          } else {
            setPasswordError('Máte špatné heslo.');
            if (passwordRef.current) {
              passwordRef.current.value = '';
              setUserPasswordInput('');
              passwordRef.current.focus();
            }
          }
        },
        true
      );
    }
  };

  // ================== IMPORT / EXPORT ==================
  // --- IMPORT EXCEL ---
  const handleImportXLSX = (e) => {
    const file = e.target.files[0];
    if (!file) {
      showModal('Chyba importu', 'Nejdříve vyberte soubor.');
      return;
    }
    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const bstr = evt.target.result;
        const wb = XLSX.read(bstr, { type: 'array' });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        const json = XLSX.utils.sheet_to_json(ws);
        await performImportXLSX(json);
      } catch (err) {
        console.error(err);
        showModal('Chyba importu', 'Soubor se nepodařilo načíst.');
      } finally {
        e.target.value = '';
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const performImportXLSX = async (json) => {
    const processedData = json.map(row => {
      const p = {
        name: row['Hráč'],
        oddil: row['Oddíl'],
        usp: parseFloat(row['Úspěšnost (%)']) / 100,
        ucast: Number(row['Účast (%)']) || 0,
        elo: Number(row['ELO']) || 0,
        turnaje: Number(row['Body za turnaje']) || 0,
        urov: Number(row['Úroveň']) || 1,
      };
      return { id: generateId(), ...p, body: calculatePlayerBody(p) }; // <<< id přidáno
    });

    const { error } = await supabase.from('players').insert(processedData);
    if (error) {
      showModal('Chyba importu', `Nepodařilo se importovat data do databáze: ${error.message}`);
    } else {
      fetchPlayers();
      showModal('Import úspěšný', 'Data byla úspěšně importována do databáze.');
    }
  };

  // --- IMPORT JSON ---
  const handleJsonFileChange = (e) => setJsonFile(e.target.files?.[0] || null);

  const handleImportJSON = () => {
    if (!jsonFile) {
      showModal('Chyba importu', 'Nejdříve vyberte JSON soubor.');
      return;
    }
    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const text = evt.target.result;
        const parsed = JSON.parse(text);
        const rows = Array.isArray(parsed)
          ? parsed
          : Array.isArray(parsed?.players)
            ? parsed.players
            : [];
        if (!rows.length) {
          showModal('Chyba importu', 'JSON soubor neobsahuje platná data.');
          return;
        }
        await performImportJSON(rows);
        setJsonFile(null);
        if (jsonInputRef.current) jsonInputRef.current.value = '';
      } catch (err) {
        console.error(err);
        showModal('Chyba importu', 'Soubor není platný JSON.');
      }
    };
    reader.readAsText(jsonFile, 'utf-8');
  };

  const performImportJSON = async (rows) => {
    const processed = rows.map((row) => {
      if (row && typeof row === 'object' && 'name' in row) {
        const p = {
          name: String(row.name),
          oddil: String(row.oddil || ''),
          usp: typeof row.usp === 'number' ? row.usp : parseFloat(row.usp) || 0,
          ucast: Number(row.ucast) || 0,
          elo: Number(row.elo) || 0,
          turnaje: Number(row.turnaje) || 0,
          urov: Number(row.urov) || 1,
        };
        return { id: generateId(), ...p, body: calculatePlayerBody(p) }; // <<< id přidáno
      } else if (row && typeof row === 'object' && 'Hráč' in row) {
        const p = {
          name: row['Hráč'],
          oddil: row['Oddíl'],
          usp: parseFloat(row['Úspěšnost (%)']) / 100,
          ucast: Number(row['Účast (%)']) || 0,
          elo: Number(row['ELO']) || 0,
          turnaje: Number(row['Body za turnaje']) || 0,
          urov: Number(row['Úroveň']) || 1,
        };
        return { id: generateId(), ...p, body: calculatePlayerBody(p) }; // <<< id přidáno
      }
      return null;
    }).filter(Boolean);

    if (!processed.length) {
      showModal('Chyba importu', 'Nebylo co importovat.');
      return;
    }

    const { error } = await supabase.from('players').insert(processed);
    if (error) {
      showModal('Chyba importu', `Nepodařilo se importovat data do databáze: ${error.message}`);
    } else {
      fetchPlayers();
      showModal('Import úspěšný', 'JSON byl úspěšně importován.');
    }
  };

  // --- EXPORTY (pro jednotlivá tlačítka) ---
  const handleExportXLSX = () => {
    if (!players.length) {
      showModal('Export dat', 'Žádná data k exportu.');
      return;
    }
    const dataForExport = players.map(p => ({
      'Poř.': p.rank,
      'Žebříček': p.bracket,
      'Hráč': p.name,
      'Oddíl': p.oddil,
      'Úspěšnost (%)': (p.usp * 100).toFixed(2),
      'Účast (%)': p.ucast,
      'ELO': p.elo,
      'Turnaje': p.turnaje,
      'Úroveň': p.urov,
      'Body': p.body ? p.body.toFixed(2) : ''
    }));
    const ws = XLSX.utils.json_to_sheet(dataForExport);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Žebříček');
    XLSX.writeFile(wb, 'zebricek.xlsx');
    showModal('Export úspěšný', 'Data byla úspěšně exportována jako zebricek.xlsx.');
  };

  const handleExportJSON = () => {
    if (!players.length) {
      showModal('Export dat', 'Žádná data k exportu.');
      return;
    }
    const blob = new Blob([JSON.stringify(players, null, 2)], { type: 'application/json' });
    saveAs(blob, 'zebricek.json');
    showModal('Export úspěšný', 'Data byla úspěšně exportována jako zebricek.json.');
  };

  const handleExportDOCX = async () => {
    if (!players.length) {
      showModal("Export dat", "Žádná data k exportu.");
      return;
    }

    const headers = [
      "Poř.", "Žebříček", "Hráč", "Oddíl",
      "Úspěšnost (%)", "Účast (%)", "ELO",
      "Turnaje", "Úroveň", "Body"
    ];

    const headerRow = new TableRow({
      children: headers.map((h) =>
        new TableCell({
          children: [
            new Paragraph({
              children: [new TextRun({ text: h, bold: true })],
            }),
          ],
        })
      ),
    });

    const dataRows = players.map((p) =>
      new TableRow({
        children: [
          String(p.rank),
          String(p.bracket),
          p.name,
          p.oddil,
          (p.usp * 100).toFixed(2),
          String(p.ucast),
          String(p.elo),
          String(p.turnaje),
          String(p.urov),
          p.body ? p.body.toFixed(2) : "",
        ].map((val) =>
          new TableCell({
            children: [new Paragraph(String(val))],
          })
        ),
      })
    );

    const table = new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [headerRow, ...dataRows],
    });

    const doc = new Document({
      sections: [
        {
          properties: {},
          children: [
            new Paragraph({
              text: "Žebříček RSST Domažlice",
              heading: HeadingLevel.HEADING1,
              alignment: AlignmentType.CENTER,
            }),
            new Paragraph({ text: `Aktualizováno: ${lastUpdate}` }),
            new Paragraph({ text: "" }),
            table,
          ],
        },
      ],
    });

    const blob = await Packer.toBlob(doc);
    saveAs(blob, 'zebricek.docx');
    showModal("Export úspěšný", "Soubor byl uložen jako zebricek.docx.");
  };

  // --- VÝROBA BLOBŮ pro zálohy (bez modálů) ---
  const buildXlsxBlob = () => {
    const dataForExport = players.map(p => ({
      'Poř.': p.rank,
      'Žebříček': p.bracket,
      'Hráč': p.name,
      'Oddíl': p.oddil,
      'Úspěšnost (%)': (p.usp * 100).toFixed(2),
      'Účast (%)': p.ucast,
      'ELO': p.elo,
      'Turnaje': p.turnaje,
      'Úroveň': p.urov,
      'Body': p.body ? p.body.toFixed(2) : ''
    }));
    const ws = XLSX.utils.json_to_sheet(dataForExport);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Žebříček');
    const ab = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
    return new Blob([ab], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  };

  const buildJsonBlob = () =>
    new Blob([JSON.stringify(players, null, 2)], { type: 'application/json' });

  const buildDocxBlob = async () => {
    const headers = [
      "Poř.", "Žebříček", "Hráč", "Oddíl",
      "Úspěšnost (%)", "Účast (%)", "ELO",
      "Turnaje", "Úroveň", "Body"
    ];
    const headerRow = new TableRow({
      children: headers.map((h) =>
        new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: h, bold: true })] })] })
      ),
    });
    const dataRows = players.map((p) =>
      new TableRow({
        children: [
          String(p.rank), String(p.bracket), p.name, p.oddil,
          (p.usp * 100).toFixed(2), String(p.ucast), String(p.elo),
          String(p.turnaje), String(p.urov), p.body ? p.body.toFixed(2) : "",
        ].map((val) => new TableCell({ children: [new Paragraph(String(val))] })),
      })
    );
    const table = new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [headerRow, ...dataRows] });
    const doc = new Document({
      sections: [{ properties: {}, children: [
        new Paragraph({ text: "Žebříček RSST Domažlice", heading: HeadingLevel.HEADING1, alignment: AlignmentType.CENTER }),
        new Paragraph({ text: `Aktualizováno: ${lastUpdate}` }),
        new Paragraph({ text: "" }),
        table,
      ]}],
    });
    return Packer.toBlob(doc);
  };

  // --- ZÁLOHY: 3 soubory / ZIP ---
  const backupThreeFiles = async () => {
    if (!players.length) {
      showModal('Záloha', 'Žádná data k záloze.');
      return;
    }
    const [docxBlob, xlsxBlob, jsonBlob] = await Promise.all([
      buildDocxBlob(),
      Promise.resolve(buildXlsxBlob()),
      Promise.resolve(buildJsonBlob()),
    ]);
    saveAs(jsonBlob, 'zebricek.json');
    saveAs(docxBlob, 'zebricek.docx');
    saveAs(xlsxBlob, 'zebricek.xlsx');
  };

  const backupZip = async () => {
    if (!players.length) {
      showModal('Záloha', 'Žádná data k záloze.');
      return;
    }
    const [docxBlob, xlsxBlob, jsonBlob] = await Promise.all([
      buildDocxBlob(),
      Promise.resolve(buildXlsxBlob()),
      Promise.resolve(buildJsonBlob()),
    ]);
    const zip = new JSZip();
    zip.file('zebricek.json', jsonBlob);
    zip.file('zebricek.docx', docxBlob);
    zip.file('zebricek.xlsx', xlsxBlob);
    const zipBlob = await zip.generateAsync({ type: 'blob' });
    saveAs(zipBlob, 'zaloha_zebricek.zip');
  };

  // ================== HLEDÁNÍ / FILTRY / ŘAZENÍ ==================
  const norm = (s) =>
    (s ?? '')
      .toString()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();

  const uniqueOddils = ['Všichni', ...new Set(players.map(p => p.oddil))].sort();

  const text = norm(searchQuery);

  const byOddil = filterOddil === 'Všichni'
    ? players
    : players.filter(p => p.oddil === filterOddil);

  const visiblePlayers = byOddil.filter(p => {
    if (!text) return true;
    const fields = [
      p.name, p.oddil, p.rank, p.bracket, p.elo, p.urov, p.ucast, p.turnaje,
      (p.usp * 100).toFixed(2),
      p.body != null ? p.body.toFixed(2) : ''
    ];
    return fields.some(val => norm(val).includes(text));
  });

  const sortedAndFilteredPlayers = [...visiblePlayers].sort((a, b) => {
    if (sortKey) {
      const valA = a[sortKey];
      const valB = b[sortKey];
      if (typeof valA === 'string' && typeof valB === 'string') {
        return sortAsc ? valA.localeCompare(valB) : valB.localeCompare(valA);
      }
      if (valA === null || valA === undefined) return sortAsc ? 1 : -1;
      if (valB === null || valB === undefined) return sortAsc ? -1 : 1;
      return sortAsc ? valA - valB : valB - valA;
    }
    return 0;
  });

  // ================== RENDER ==================
  return (
    <>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem', gap: '2rem' }}>
        <h1 className="logo">RSST Domažlice</h1>
        {weatherData ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#FFD700', fontSize: '1.5rem', fontFamily: "'Trebuchet MS', sans-serif" }} title={weatherData.description}>
            <span>{weatherData.temperature}°C</span>
            <span>{weatherData.icon}</span>
          </div>
        ) : weatherError ? (
          <div style={{ color: '#FFD700', fontSize: '1.2rem', fontFamily: "'Trebuchet MS', sans-serif" }}>{weatherError}</div>
        ) : (
          <div style={{ color: '#FFD700', fontSize: '1.2rem', fontFamily: "'Trebuchet MS', sans-serif" }}>Načítám počasí...</div>
        )}
      </header>

      <main>
        <div className="container">
          <section className="form-section">
            <h2 className="calc-title">Výpočet bodů do okresního žebříčku</h2>
            <form onSubmit={handleSubmit} id="zebricek-form">
              <label htmlFor="hrac">Hráč</label>
              <input type="text" id="hrac" value={formData.hrac} onChange={handleFormChange} required />
              <label htmlFor="oddil">Oddíl</label>
              <input type="text" id="oddil" value={formData.oddil} onChange={handleFormChange} required />
              <label htmlFor="uspesnost">Úspěšnost (%)</label>
              <input type="number" id="uspesnost" value={formData.uspesnost} onChange={handleFormChange} step="0.01" required />
              <label htmlFor="ucast">Účast (%)</label>
              <input type="number" id="ucast" value={formData.ucast} onChange={handleFormChange} step="0.1" required />
              <label htmlFor="elo">ELO</label>
              <input type="number" id="elo" value={formData.elo} onChange={handleFormChange} required />
              <label htmlFor="turnaje">Body za turnaje</label>
              <input type="number" id="turnaje" value={formData.turnaje} onChange={handleFormChange} />
              <label htmlFor="uroven">Úroveň (1–9)</label>
              <select id="uroven" value={formData.uroven} onChange={handleFormChange}>
                <option value="1">1</option><option value="2">2</option><option value="3">3</option>
                <option value="4">4</option><option value="5">5</option><option value="6">6</option>
                <option value="7">7</option><option value="8">8</option><option value="9">9</option>
              </select>
              <button type="submit" className="btn-calc">
                {editingPlayerId ? 'Upravit hráče' : 'Spočítat'}
              </button>
            </form>

            {/* Importy */}
            <div className="imports">
              <label htmlFor="import-xlsx">Import z Excelu:</label>
              <input type="file" id="import-xlsx" accept=".xlsx,.xls" onChange={handleImportXLSX} />
            </div>

            <div className="imports" style={{ marginTop: '1rem' }}>
              <label htmlFor="import-json">Import JSON:</label>
              <input
                ref={jsonInputRef}
                type="file"
                id="import-json"
                accept=".json,application/json"
                onChange={handleJsonFileChange}
              />
              <button onClick={handleImportJSON} disabled={!jsonFile} style={{ marginTop: '0.5rem' }}>
                Načíst JSON
              </button>
            </div>

            {/* Exporty */}
            <div className="exports">
              <button id="export-xlsx" onClick={handleExportXLSX}>Export Excel</button>
              <button id="export-docx" onClick={handleExportDOCX}>Export Word</button>
              <button id="export-json" onClick={handleExportJSON}>Export JSON</button>
            </div>

            {/* Zálohy – barvy a výška řízené proměnnými výše */}
            <button type="button" onClick={backupThreeFiles} style={backupBtnStyle}>
              Zálohovat (JSON + Word + Excel)
            </button>

            <button type="button" onClick={backupZip} style={backupZipBtnStyle}>
              Zálohovat ZIP
            </button>

            <button
              id="delete-all"
              onClick={handleDeleteAll}
              style={{ marginTop: '12px', background: '#f44336', color: '#fff', border: 'none', padding: '10px 16px', borderRadius: '10px', cursor: 'pointer', display: 'block', width: '100%' }}
            >
              Smazat vše
            </button>

            {/* Hledání */}
            <div className="search-bar" style={{
              margin: '0.75rem 0 1rem',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              flexWrap: 'wrap'
            }}>
              <span aria-hidden="true" style={{ fontSize: '1.1rem' }}>🔍</span>
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Hledat (hráč, oddíl, ELO, body, pořadí...)"
                style={{
                  flex: '1 1 280px',
                  maxWidth: '380px',
                  padding: '6px 10px',
                  border: '1px solid #ccc',
                  borderRadius: '6px'
                }}
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  title="Vyčistit hledání"
                  style={{
                    border: '1px solid #ccc',
                    background: '#f5f5f5',
                    borderRadius: '6px',
                    padding: '6px 10px',
                    cursor: 'pointer'
                  }}
                >
                  ×
                </button>
              )}
              <small style={{ color: '#666', marginLeft: 'auto' }}>
                {sortedAndFilteredPlayers.length} / {players.length} hráčů
              </small>
            </div>
          </section>

          {/* Tabulka */}
          <section className="table-section">
            <div className="update-bar">
              <label>Aktualizováno:</label>
              <input type="text" id="last-update" value={lastUpdate} readOnly />
            </div>
            <div className="filter-bar">
              <label htmlFor="filter-oddil">Filtr oddílu:</label>
              <select id="filter-oddil" value={filterOddil} onChange={handleFilterChange}>
                {uniqueOddils.map(oddil => (<option key={oddil} value={oddil}>{oddil}</option>))}
              </select>
            </div>

            {loading ? (
              <p>Načítám data...</p>
            ) : error ? (
              <p>Chyba při načítání dat: {error.message}</p>
            ) : (
              <table id="zebricek-table">
                <thead>
                  <tr>
                    <th className="sortable" data-key="rank" onClick={() => handleSort('rank')}>Poř.</th>
                    <th>Žebříček</th>
                    <th className="col-left sortable" data-key="name" onClick={() => handleSort('name')}>Hráč</th>
                    <th className="col-left sortable" data-key="oddil" onClick={() => handleSort('oddil')}>Oddíl ⇅</th>
                    <th className="align-right">Úspěšn. %</th>
                    <th className="align-right">Účast %</th>
                    <th className="align-right">ELO</th>
                    <th className="align-center">Turnaje</th>
                    <th className="align-center sortable" data-key="urov" onClick={() => handleSort('urov')}>Úroveň</th>
                    <th className="align-right sortable" data-key="body" onClick={() => handleSort('body')}>Body</th>
                    <th>Akce</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedAndFilteredPlayers.map((player) => (
                    <tr key={player.id}>
                      <td>{player.rank}</td>
                      <td className="align-center">{player.bracket}</td>
                      <td className="col-left">{player.name}</td>
                      <td className="col-left">{player.oddil}</td>
                      <td className="align-right">{(player.usp * 100).toFixed(2)}</td>
                      <td className="align-right">{player.ucast}</td>
                      <td className="align-right">{player.elo}</td>
                      <td className="align-center">{player.turnaje}</td>
                      <td className="align-center">{player.urov}</td>
                      <td className="align-right">{player.body ? player.body.toFixed(2) : ''}</td>
                      <td>
                        <button className="row-btn btn-edit" onClick={() => handleEditPlayer(player.id)}>✎</button>
                        <button className="row-btn btn-delete" onClick={() => handleDeletePlayer(player.id, player.name)}>×</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </div>
      </main>

      {showScrollToTopButton && (
        <button id="to-top" title="Zpět nahoru" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          style={{ display: 'block', position: 'fixed', bottom: '60px', right: '20px', backgroundColor: '#cddc39', border: 'none', padding: '.5rem .75rem', borderRadius: '50%', fontSize: '1.5rem', cursor: 'pointer', zIndex: 999 }}>
          ↑
        </button>
      )}
      {showScrollToBottomButton && (
        <button id="to-bottom" title="Dolu" onClick={() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' })}
          style={{ display: 'block', position: 'fixed', bottom: '20px', right: '20px', backgroundColor: '#cddc39', border: 'none', padding: '.5rem .75rem', borderRadius: '50%', fontSize: '1.5rem', cursor: 'pointer', zIndex: 999 }}>
          ↓
        </button>
      )}

      {isModalOpen && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0, 0, 0, 0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000 }}>
          <div style={{ backgroundColor: '#fff', padding: '20px', borderRadius: '8px', boxShadow: '0 4px 10px rgba(0, 0, 0, 0.2)', maxWidth: '400px', width: '90%', textAlign: 'center' }}>
            <h3 style={{ marginTop: 0, color: '#333' }}>{modalTitle}</h3>
            <p style={{ marginBottom: isPasswordPrompt ? '12px' : '20px', color: '#555' }}>{modalMessage}</p>

            {isPasswordPrompt && (
              <>
                <input
                  ref={passwordRef}
                  type="password"
                  autoFocus
                  onChange={(e) => setUserPasswordInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      modalConfirmCallback?.();
                    }
                  }}
                  style={{ marginBottom: '8px', width: '100%' }}
                />
                {passwordError && (
                  <div style={{ color: '#e53935', marginBottom: '12px', fontSize: '0.9rem' }}>
                    {passwordError}
                  </div>
                )}
              </>
            )}

            {modalConfirmCallback ? (
              <div>
                <button onClick={modalConfirmCallback} style={{ backgroundColor: '#2e7d32', color: '#fff', border: 'none', padding: '8px 15px', borderRadius: '4px', cursor: 'pointer', marginRight: '10px' }}>Ano</button>
                <button onClick={closeModal} style={{ backgroundColor: '#e53935', color: '#fff', border: 'none', padding: '8px 15px', borderRadius: '4px', cursor: 'pointer' }}>Ne</button>
              </div>
            ) : (
              <button onClick={closeModal} style={{ backgroundColor: '#1565c0', color: '#fff', border: 'none', padding: '8px 15px', borderRadius: '4px', cursor: 'pointer' }}>OK</button>
            )}
          </div>
        </div>
      )}
    </>
  );
}

export default App;
