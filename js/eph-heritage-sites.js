'use strict';

const CHUNK_SIZE = 35;
let currentRenderIndex = 0;
let currentFilteredRecords = [];
let currentFilterMode = 'intersection';
let currentRegionFilter = 'indonesia_only';
let currentGenderFilter = 'all';
let activePekerjaan = new Set();
let PekerjaanButtons = {};

// 1. Fungsi Persiapan
function doPreProcessing() {
  let anchorElem = document.getElementById('wdqs-link');
  if (anchorElem) anchorElem.href = 'https://query.wikidata.org/#' + encodeURIComponent(ABOUT_SPARQL_QUERY);
  processHashChange();
}

// 2. Fungsi Pemuat Utama
function loadPrimaryData() {
  doPreProcessing();

  Promise.all([
    fetch('peta-provinsi.json').then(res => {
        if (!res.ok) throw new Error("File 'peta-provinsi.json' tidak ditemukan.");
        return res.json();
    }),
    fetch('data-tokoh.json').then(res => {
        if (!res.ok) throw new Error("File 'data-tokoh.json' tidak ditemukan.");
        return res.json();
    })
  ])
  .then(([dataProvinsi, dataTokoh]) => {
    if (dataProvinsi && dataProvinsi.results && dataProvinsi.results.bindings) {
       dataProvinsi.results.bindings.forEach(row => {
           if (row.tempatLahirQid && row.provinsiLabel) {
               PetaProvinsi[row.tempatLahirQid.value] = row.provinsiLabel.value;
           }
       });
    }
    if (!dataTokoh || !dataTokoh.results || !dataTokoh.results.bindings) {
       throw new Error("Format JSON Tokoh salah!");
    }

    dataTokoh.results.bindings.forEach(result => {
      if (!result.site || !result.site.value) return;

      let qid = result.site.value.split('/').pop();
      if (!(qid in Records)) Records[qid] = new Record();
      let record = Records[qid];

      record.title = result.siteLabel ? result.siteLabel.value : `Tokoh (${qid})`;
      record.indexTitle = record.title;
      if (result.tempatLahirUrl) record.tempatLahirQid = result.tempatLahirUrl.value.split('/').pop();

      if (result.coord) {
        let wktBits = result.coord.value.split(/\(|\)| /);
        if (wktBits.length >= 3) {
            record.lat = parseFloat(wktBits[2]);
            record.lon = parseFloat(wktBits[1]);
        }
      }

      if (result.image && !record.imageFilename && typeof extractImageFilename === 'function') {
         record.imageFilename = extractImageFilename(result.image);
      }
      if (result.wikiTitle) record.articleTitle = decodeURIComponent(result.wikiTitle.value);

      if (result.genderUrl) {
         let genderQid = result.genderUrl.value.split('/').pop();
         if (typeof KAMUS_GENDER !== 'undefined' && KAMUS_GENDER[genderQid]) {
            record.jenisKelamin = KAMUS_GENDER[genderQid];
         }
      }
if (result.pekerjaanList) {
         let jobs = result.pekerjaanList.value.split(',');
         
         record.pekerjaanQids = new Set(); 
         
         jobs.forEach(jobUrl => {
             let jobQid = jobUrl.split('/').pop();
             record.pekerjaanQids.add(jobQid); 
             
             if (typeof KAMUS_PEKERJAAN !== 'undefined' && KAMUS_PEKERJAAN[jobQid]) {
                record.pekerjaan.add(KAMUS_PEKERJAAN[jobQid]);
             }
         });
      }
      
      if (result.provinsiLabel && record.tempatLahirQid) {
         PetaProvinsi[record.tempatLahirQid] = result.provinsiLabel.value;
      }
    });

    // Memasukkan butir tempat lahir selian provinsi/wilayah historis Indonesia lainnya ---
    // Tujuannya agar tidak terbuang ke "Luar Negeri"
    PetaProvinsi['Q252'] = 'Indonesia (Umum)';
    PetaProvinsi['Q188161'] = 'Hindia Belanda';
    PetaProvinsi['Q3492'] = 'Sumatera';
    PetaProvinsi['Q3757'] = 'Jawa';
    PetaProvinsi['Q3812'] = 'Sulawesi';
    BootstrapDataIsLoaded = true;
    buildDynamicIndices();
    populateMapAndIndex();
    updateFeatureCounts();
    if (typeof enableApp === 'function') enableApp();
  })
  .catch(error => {
    console.error("Kesalahan Sistem:", error);
    alert("Gagal memuat data: " + error.message);
  });
}

// 3. Pembangun Indeks
function buildDynamicIndices() {
  BirthplaceIndex = { all: new IndexEntry() };
  PekerjaanIndex = { all: new IndexEntry() };

  Object.values(Records).forEach(record => {
    BirthplaceIndex.all.total++;
    PekerjaanIndex.all.total++;

    let regionLabel = "Luar Negeri";
    if (record.tempatLahirQid && PetaProvinsi[record.tempatLahirQid]) {
      regionLabel = PetaProvinsi[record.tempatLahirQid];
    }

    record.provinsiLabel = regionLabel;
    record.areaTags.add(regionLabel);

    if (!(regionLabel in BirthplaceIndex)) {
      BirthplaceIndex[regionLabel] = new IndexEntry();
      BirthplaceIndex[regionLabel].label = regionLabel;
    }
    BirthplaceIndex[regionLabel].total++;

    record.pekerjaan.forEach(pkj => {
      if (!(pkj in PekerjaanIndex)) {
        PekerjaanIndex[pkj] = new IndexEntry();
        PekerjaanIndex[pkj].label = pkj;
      }
      PekerjaanIndex[pkj].total++;
    });
  });
}

// 4. Perenderan Peta & Marker, modifikasi dari wikisocph
function populateMapAndIndex() {
  Object.entries(Records).forEach(entry => {
    let qid = entry[0], record = entry[1];

    if (record.lat && record.lon) {
      let mapMarker = L.marker(
        [record.lat, record.lon],
        { icon: L.ExtraMarkers.icon({ icon: 'fa-user', markerColor : 'orange-dark', prefix: 'fa' }) }
      );
      record.mapMarker = mapMarker;
      mapMarker.bindPopup(record.title, { closeButton: false });

      let popup = mapMarker.getPopup();
      popup._qid = qid;
      record.popup = popup;
    }

    // Hanya membuat elemen <li> di memori, nanti dimasukkan ke HTML
    let li = document.createElement('li');
    li.innerHTML = `<a href="#${qid}" id="idx-${qid}">${record.indexTitle}</a>`;
    record.indexLi = li;
  });

  generateFilterSelect();  
  applyIntersectionFilter();  
  processHashChange();
}

// 5. Filter Tokoh Indonesia oleh Denas
function generateFilterSelect() {
  let selectRegion = document.getElementById('filter-region');
  let selectGender = document.getElementById('filter-gender');
  let containerPekerjaan = document.getElementById('filter-pekerjaan-buttons');
  let btnAllPekerjaan = document.getElementById('btn-all-pekerjaan');

if(selectRegion) {
    let totalLuarNegeri = BirthplaceIndex['Luar Negeri'] ? BirthplaceIndex['Luar Negeri'].total : 0;
    let totalIndonesia = BirthplaceIndex.all.total - totalLuarNegeri;
    selectRegion.innerHTML = `
      <option value="indonesia_only" selected>Seluruh Indonesia – ${totalIndonesia} Tokoh</option>
    `;
    let sortedRegions = Object.keys(BirthplaceIndex)
      .filter(lbl => 
          lbl !== 'all' && 
          lbl !== 'Luar Negeri' && 
          lbl !== 'Indonesia (Umum)' && 
          lbl !== 'Hindia Belanda' &&
          lbl !== 'Sumatera' &&
          lbl !== 'Jawa' &&
          lbl !== 'Sulawesi'
      )
      .sort((a, b) => a.localeCompare(b));
    sortedRegions.forEach(lbl => {
      let option = document.createElement('option');
      option.value = lbl;
      option.textContent = `${lbl} – ${BirthplaceIndex[lbl].total} Tokoh`;
      selectRegion.appendChild(option);
    });
    if (BirthplaceIndex['Luar Negeri']) {
      let optionLN = document.createElement('option');
      optionLN.value = 'Luar Negeri';
      optionLN.textContent = `Luar Negeri – ${BirthplaceIndex['Luar Negeri'].total} Tokoh`;
      selectRegion.appendChild(optionLN);
    }
    if (BirthplaceIndex.all) {
      let optionAll = document.createElement('option');
      optionAll.value = 'all';
      optionAll.textContent = `Semua Tempat Lahir – ${BirthplaceIndex.all.total} Tokoh`;
      selectRegion.appendChild(optionAll);
    }

    selectRegion.addEventListener('change', function() {
      currentRegionFilter = this.value;
      updateFeatureCounts();
      applyIntersectionFilter();
      this.blur();
    });
  }

  if (containerPekerjaan && btnAllPekerjaan) {
    let sortedPekerjaan = Object.keys(PekerjaanIndex)
      .filter(label => label !== 'all')
      .sort((a, b) => PekerjaanIndex[a].label.localeCompare(PekerjaanIndex[b].label));

    let featButtons = [];
    PekerjaanButtons = {};

    sortedPekerjaan.forEach(pkj => {
      let btn = document.createElement('button');
      btn.className = 'feat-btn';
      btn.setAttribute('data-filter', pkj);
      btn.textContent = `${PekerjaanIndex[pkj].label} (${PekerjaanIndex[pkj].total})`;

      PekerjaanButtons[pkj] = btn;

btn.addEventListener('click', function() {
        let filterType = this.getAttribute('data-filter');
        let modeElement = document.querySelector('input[name="job_mode"]:checked');
        let activeMode = modeElement ? modeElement.value : 'single';

        if (activeMode === 'single') {
          if (activePekerjaan.has(filterType)) {
            activePekerjaan.delete(filterType);
            this.classList.remove('active');
          } else {
            activePekerjaan.clear();
            featButtons.forEach(b => b.classList.remove('active')); 
            activePekerjaan.add(filterType);
            this.classList.add('active');
          }
        } else {
          if (activePekerjaan.has(filterType)) {
            activePekerjaan.delete(filterType);
            this.classList.remove('active');
          } else {
            activePekerjaan.add(filterType);
            this.classList.add('active');
          }
        }

        if (activePekerjaan.size === 0) {
          btnAllPekerjaan.classList.add('active');
        } else {
          btnAllPekerjaan.classList.remove('active');
        }

        updateFeatureCounts();
        applyIntersectionFilter();
      });

      containerPekerjaan.appendChild(btn);
      featButtons.push(btn);
    });

    btnAllPekerjaan.addEventListener('click', function() {
      activePekerjaan.clear();
      this.classList.add('active');
      featButtons.forEach(b => b.classList.remove('active'));
      updateFeatureCounts();
      applyIntersectionFilter();
    });
  }
let modeRadios = document.querySelectorAll('input[name="job_mode"]');
  modeRadios.forEach(radio => {
    radio.addEventListener('change', function() {
      let selectedMode = this.value;
      if (selectedMode === 'single' && activePekerjaan.size > 1) {
        activePekerjaan.clear();
        let allFeatBtns = document.querySelectorAll('.feat-btn[data-filter]');
        allFeatBtns.forEach(b => b.classList.remove('active'));
        let btnAll = document.getElementById('btn-all-pekerjaan');
        if (btnAll) btnAll.classList.add('active');
      }
      
      updateFeatureCounts();
      applyIntersectionFilter();
      
    });
  });
}
// 6. Kalkulator Tombol Angka oleh Denas
function updateFeatureCounts() {
  let selectRegion = document.getElementById('filter-region');
  let selectGender = document.getElementById('filter-gender');
  let modeElement = document.querySelector('input[name="job_mode"]:checked');
  let activeRegion = selectRegion ? selectRegion.value : 'all';
  let activeGender = selectGender ? selectGender.value : 'all';
  let activeMode = modeElement ? modeElement.value : 'single';

  let totalUnion = 0;
  let totalIntersection = 0;
  let tempJobCounts = {};
  let tempRegionCounts = { 'all': 0, 'indonesia_only': 0 };
  let tempGenderCounts = { 'all': 0, 'laki-laki': 0, 'perempuan': 0 };

  Object.keys(PekerjaanIndex).forEach(pkj => { if (pkj !== 'all') tempJobCounts[pkj] = 0; });
  Object.keys(BirthplaceIndex).forEach(region => { if (region !== 'all') tempRegionCounts[region] = 0; });

  Object.values(Records).forEach(record => {
    let matchRegion = false;
    if (activeRegion === 'all') matchRegion = true;
    else if (activeRegion === 'indonesia_only') matchRegion = !record.areaTags.has('Luar Negeri');
    else matchRegion = record.areaTags.has(activeRegion);

    let matchGender = false;
    if (activeGender === 'all') matchGender = true;
    else if (activeGender === record.jenisKelamin) matchGender = true;

    let matchPekerjaan = true;
    if (activePekerjaan.size > 0) {
      if (activeMode === 'union') {
        matchPekerjaan = Array.from(activePekerjaan).some(pkj => record.pekerjaan.has(pkj));
      } else {
        matchPekerjaan = Array.from(activePekerjaan).every(pkj => record.pekerjaan.has(pkj));
      }
    }

    if (matchRegion && matchGender) {
      record.pekerjaan.forEach(pkj => {
        if (tempJobCounts[pkj] !== undefined) tempJobCounts[pkj]++;
      });
      let hasAny = true; let hasAll = true;
      if (activePekerjaan.size > 0) {
        hasAny = Array.from(activePekerjaan).some(pkj => record.pekerjaan.has(pkj));
        hasAll = Array.from(activePekerjaan).every(pkj => record.pekerjaan.has(pkj));
      }
      if (hasAny) totalUnion++;
      if (hasAll) totalIntersection++;
    }

    if (matchGender && matchPekerjaan) {
      tempRegionCounts['all']++;
      if (!record.areaTags.has('Luar Negeri')) tempRegionCounts['indonesia_only']++;
      record.areaTags.forEach(tag => {
        if (tempRegionCounts[tag] !== undefined) tempRegionCounts[tag]++;
      });
    }

    if (matchRegion && matchPekerjaan) {
      tempGenderCounts['all']++;
      if (record.jenisKelamin === 'laki-laki') tempGenderCounts['laki-laki']++;
      if (record.jenisKelamin === 'perempuan') tempGenderCounts['perempuan']++;
    }
  });

  if (selectRegion) {
    Array.from(selectRegion.options).forEach(opt => {
      let val = opt.value;
      let count = tempRegionCounts[val] || 0;
      if (val === 'all') opt.textContent = `Semua Tempat Lahir – ${count} Tokoh`;
      else if (val === 'indonesia_only') opt.textContent = `Seluruh Indonesia – ${count} Tokoh`;
      else opt.textContent = `${val} – ${count} Tokoh`;
    });
  }

  if (selectGender) {
    Array.from(selectGender.options).forEach(opt => {
      let val = opt.value;
      let count = tempGenderCounts[val] || 0;
      if (val === 'all') opt.textContent = `Semua Jenis Kelamin`;
      else opt.textContent = `${val} – ${count} Tokoh`;
    });
  }

  Object.keys(tempJobCounts).forEach(pkj => {
    if (PekerjaanButtons[pkj]) {
      PekerjaanButtons[pkj].textContent = `${PekerjaanIndex[pkj].label} (${tempJobCounts[pkj]})`;
    }
  });

  let sortedJobs = Object.keys(tempJobCounts).sort((a, b) => {
     if (tempJobCounts[b] !== tempJobCounts[a]) return tempJobCounts[b] - tempJobCounts[a];
     return PekerjaanIndex[a].label.localeCompare(PekerjaanIndex[b].label);
  });

  sortedJobs.forEach((pkj, index) => {
     if (PekerjaanButtons[pkj]) PekerjaanButtons[pkj].style.order = index + 1;
  });

  let btnAllPekerjaan = document.getElementById('btn-all-pekerjaan');
  if (btnAllPekerjaan) btnAllPekerjaan.style.order = 0;

let labelIrisan = document.getElementById('label-irisan');
  let labelGabungan = document.getElementById('label-gabungan');
  
  // Mengecek apakah tombol pekerjaan yang aktif berjumlah 2 atau lebih
  if (activePekerjaan.size >= 2) {
    // Jika 2 atau lebih, tampilkan jumlah tokohnya
    if (labelIrisan) labelIrisan.textContent = `Rangkap Pekerjaan (${totalIntersection} Tokoh)`;
    if (labelGabungan) labelGabungan.textContent = `Memiliki Salah Satu Pekerjaan (${totalUnion} Tokoh)`;
  } else {
    // Jika kurang dari 2 (1 atau 0), sembunyikan angka dan beri petunjuk
    if (labelIrisan) labelIrisan.textContent = `Rangkap Pekerjaan (Silakan pilih minimal 2 pekerjaan)`;
    if (labelGabungan) labelGabungan.textContent = `Memiliki Salah Satu Pekerjaan (Silakan pilih minimal 2 pekerjaan)`;
  }
}

// 7. Mesin Eksekutor Gabungan/Irisan
function applyIntersectionFilter() {
  let selectRegion = document.getElementById('filter-region');
  let selectGender = document.getElementById('filter-gender');
  let modeElement = document.querySelector('input[name="job_mode"]:checked');
  let searchInput = document.getElementById('search-tokoh');
  let activeRegion = selectRegion ? selectRegion.value : 'all';
  let activeGender = selectGender ? selectGender.value : 'all';
 let activeMode = modeElement ? modeElement.value : 'single';
  let keywordCari = searchInput ? searchInput.value.toLowerCase() : '';

  // Filter Data Array Mentah
  currentFilteredRecords = Object.values(Records).filter(record => {
    let matchRegion = false;
    if (activeRegion === 'all') matchRegion = true;
    else if (activeRegion === 'indonesia_only') matchRegion = !record.areaTags.has('Luar Negeri');
    else matchRegion = record.areaTags.has(activeRegion);

    let matchGender = false;
    if (activeGender === 'all') matchGender = true;
    else if (activeGender === record.jenisKelamin) matchGender = true;

    let matchPekerjaan = true;
    if (activePekerjaan.size > 0) {
      if (activeMode === 'union') {
        matchPekerjaan = Array.from(activePekerjaan).some(pkj => record.pekerjaan.has(pkj));
      } else {
        matchPekerjaan = Array.from(activePekerjaan).every(pkj => record.pekerjaan.has(pkj));
      }
    }

    let matchSearch = keywordCari === '' || record.indexTitle.toLowerCase().includes(keywordCari);
    return matchRegion && matchGender && matchPekerjaan && matchSearch;
  }).sort((a, b) => {
    return a.indexTitle.localeCompare(b.indexTitle);
  });

  let ol = document.getElementById('index-list');
  if(ol) ol.innerHTML = '';
  currentRenderIndex = 0;

  renderNextChunk();
  Cluster.clearLayers();
  let validMarkers = currentFilteredRecords.map(r => r.mapMarker).filter(m => m !== undefined);
  
  if (validMarkers.length > 0) {
    Cluster.addLayers(validMarkers);
    let bounds = Cluster.getBounds();
    if (bounds && Object.keys(bounds).length > 0) {
       Map.fitBounds(bounds);
    }
  }
}

// Fitur Pencarian Teks oleh Denas
let inputPencarian = document.getElementById('search-tokoh');
if (inputPencarian) {
  inputPencarian.addEventListener('input', function() {
    applyIntersectionFilter(); 
  });
}

// 8. Live Fetch Profil & Wikipedia dari Wikidata, modifikasi dari wikisocph
function generateRecordDetails(qid) {
  let record = Records[qid];

  let titleHtml = `<h1 id="title-header-${qid}">Memuat nama...</h1>`;
  let figureHtml = generateFigure(record.imageFilename);

  let articleHtml = '<div class="article main-text loading"><div class="loader"></div></div>';

  let infoHtml = '<h2>Informasi Profil</h2>';
  infoHtml += `<div id="img-lokasi-${qid}" class="lokasi-img-container"></div>`;
  infoHtml += '<ul class="designations">';
  infoHtml += `<li><p><strong>Lahir:</strong> <span id="lokasi-${qid}">Memuat lokasi...</span> (${record.provinsiLabel})</p></li>`;

  if (record.jenisKelamin) infoHtml += `<li><p><strong>Jenis kelamin:</strong> ${record.jenisKelamin}</p></li>`;

  if (record.pekerjaanQids && record.pekerjaanQids.size > 0) {
    infoHtml += `<li><p><strong>Pekerjaan:</strong> <span id="pekerjaan-${qid}">Memuat pekerjaan...</span></p></li>`;
  }
  infoHtml += '</ul>';

  let panelElem = document.createElement('div');
  panelElem.innerHTML =
    `<a class="main-wikidata-link" href="https://www.wikidata.org/wiki/${qid}" target="_blank" title="Lihat di Wikidata">` +
    '<img src="img/wikidata_tiny_logo.png" alt="[Lihat item Wikidata]" /></a>' +
    titleHtml + figureHtml + articleHtml + infoHtml;

  record.panelElem = panelElem;

  let queryIds = qid;
  if (record.tempatLahirQid) queryIds += `|${record.tempatLahirQid}`;

  let arrPekerjaanQid = [];
  if (record.pekerjaanQids && record.pekerjaanQids.size > 0) {
      arrPekerjaanQid = Array.from(record.pekerjaanQids);
      queryIds += `|${arrPekerjaanQid.join('|')}`;
  }

  fetch(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${queryIds}&props=labels|sitelinks|claims&languages=id|en&format=json&origin=*`)
    .then(res => res.json())
    .then(data => {
        let entPerson = data.entities[qid];
        if (entPerson) {
          let realName = entPerson.labels.id ? entPerson.labels.id.value : (entPerson.labels.en ? entPerson.labels.en.value : qid);
          let headerEl = panelElem.querySelector(`#title-header-${qid}`);
          if(headerEl) headerEl.textContent = realName;

          let idxEl = document.getElementById(`idx-${qid}`);
          if(idxEl) idxEl.textContent = realName;

          if(record.mapMarker) record.mapMarker.setPopupContent(realName);
          record.title = realName;
          record.indexTitle = realName;

          let articleContainer = panelElem.querySelector('.article');
          if (entPerson.sitelinks && entPerson.sitelinks.idwiki) {
              let wikiTitle = entPerson.sitelinks.idwiki.title;
              displayArticleExtract(wikiTitle, articleContainer);
          } else {
              articleContainer.innerHTML = '<p><em>Tokoh ini belum memiliki artikel Wikipedia berbahasa Indonesia.</em></p>';
              articleContainer.classList.remove('loading');
          }
        }

        if (record.tempatLahirQid) {
          let entCity = data.entities[record.tempatLahirQid];
          if (entCity) {
            let cityName = entCity.labels.id ? entCity.labels.id.value : (entCity.labels.en ? entCity.labels.en.value : record.tempatLahirQid);
            let lokEl = panelElem.querySelector(`#lokasi-${qid}`);
            if(lokEl) lokEl.textContent = cityName;
            
            let imgLokasiEl = panelElem.querySelector(`#img-lokasi-${qid}`);
            if (imgLokasiEl && entCity.claims && entCity.claims.P18) {
                let imgFileName = entCity.claims.P18[0].mainsnak.datavalue.value;
                let encodedFileName = encodeURIComponent(imgFileName);
                
                let commonsFileUrl = `https://commons.wikimedia.org/wiki/File:${encodedFileName}`;
                let imgUrl = `https://commons.wikimedia.org/wiki/Special:FilePath/${encodedFileName}?width=300`;
                
                imgLokasiEl.innerHTML = `
                  <figure class="">
                    <a href="${commonsFileUrl}" target="_blank">
                      <img class="" src="${imgUrl}" alt="${cityName}" onload="this.className=''">
                    </a>
                    <figcaption id="caption-lokasi-${qid}">${cityName}</figcaption>
                  </figure>
                `;
            }
          }
        }

        if (arrPekerjaanQid.length > 0) {
            let daftarLabelPekerjaan = [];
            
            arrPekerjaanQid.forEach(pkjQid => {
                let entPkj = data.entities[pkjQid];
                if (entPkj) {
                    let labelPkj = entPkj.labels.id ? entPkj.labels.id.value : (entPkj.labels.en ? entPkj.labels.en.value : null);
                    if (!labelPkj && KAMUS_PEKERJAAN[pkjQid]) labelPkj = KAMUS_PEKERJAAN[pkjQid];
                    if (labelPkj) daftarLabelPekerjaan.push(labelPkj);
                } else if (KAMUS_PEKERJAAN[pkjQid]) {
                    daftarLabelPekerjaan.push(KAMUS_PEKERJAAN[pkjQid]);
                }
            });

let pkjEl = panelElem.querySelector(`#pekerjaan-${qid}`);
if (pkjEl) {
    let tautanSunting = ` <a href="https://www.wikidata.org/wiki/${qid}#P106" target="_blank" class="sunting-link" title="Sunting pekerjaan di Wikidata">[sunting]</a>`;
    if (daftarLabelPekerjaan.length > 0) {
        pkjEl.innerHTML = daftarLabelPekerjaan.join(', ') + tautanSunting;
    } else {
        pkjEl.innerHTML = Array.from(record.pekerjaan).join(', ') + tautanSunting;
    }
}
        }
    })
    .catch(err => console.log("Gagal memuat API dari Wikidata", err));
}

// 9. Penarik Artikel Wikipedia, modifikasi dari wikisocph
function displayArticleExtract(title, elem) {
  let apiUrl = `https://id.wikipedia.org/w/api.php?action=query&format=json&prop=extracts&exintro=1&redirects=true&titles=${encodeURIComponent(title)}&origin=*`;

  fetch(apiUrl)
    .then(response => response.json())
    .then(data => {
      let pages = data.query.pages;
      let pageId = Object.keys(pages)[0];
      let extract = pages[pageId].extract;

      if (extract) {
          let paragraphs = extract.match(/<p[^>]*>[\s\S]*?<\/p>/g);
          let validText = paragraphs ? paragraphs.find(text => text.length > 35) : extract;
          if (!validText) validText = extract;

          elem.innerHTML = validText +
            '<p class="wikipedia-link">' +
              `<a href="https://id.wikipedia.org/wiki/${encodeURIComponent(title)}" target="_blank">` +
                '<img src="img/wikipedia_tiny_logo.png" alt="" />' +
                '<span>Baca selengkapnya di Wikipedia</span>' +
              '</a>' +
            '</p>';
      } else {
          elem.innerHTML = '<p><em>Cuplikan artikel belum tersedia di Wikipedia.</em></p>';
      }

      elem.classList.remove('loading');
    })
    .catch(error => {
      console.error("Gagal menarik data Wikipedia:", error);
      elem.innerHTML = '<p><em>Gagal memuat cuplikan. Periksa koneksi internet Anda.</em></p>';
      elem.classList.remove('loading');
    });
}

// 10. Kelas Struktur Data
class IndexEntry {
  constructor() {
    this.label = '';
    this.total = 0;
  }
}

class Record {
  constructor() {
    this.title = undefined;
    this.imageFilename = '';
    this.articleTitle = undefined;

    this.tempatLahirQid = undefined;
    this.provinsiLabel = undefined;
    this.jenisKelamin = undefined;
    this.pekerjaan = new Set();

    this.lat = undefined;
    this.lon = undefined;
    this.mapMarker = undefined;
    this.popup = undefined;
    this.panelElem = undefined;
    this.indexLi = undefined;
    this.areaTags = new Set();
  }
}

// Fungsi baru untuk memuat sebagian data ke DOM
function renderNextChunk() {
  let ol = document.getElementById('index-list');
  if (!ol) return;

  let nextBatch = currentFilteredRecords.slice(currentRenderIndex, currentRenderIndex + CHUNK_SIZE);  
  if (nextBatch.length === 0) return;
  let fragment = document.createDocumentFragment();

  nextBatch.forEach(record => {
    if (record.indexLi) {
      record.indexLi.style.display = '';
      fragment.appendChild(record.indexLi);
    }
  });

  ol.appendChild(fragment);
  currentRenderIndex += CHUNK_SIZE;
}

let scrollContainer = document.getElementById('index-container'); // Catatanku, sesuaikan ID kontainer di HTML

if (scrollContainer) {
  scrollContainer.addEventListener('scroll', function() {
    // Jika posisi scroll + tinggi layar >= total tinggi konten (dikurangi 10px sebagai toleransi)
    if (this.scrollTop + this.clientHeight >= this.scrollHeight - 10) {
      renderNextChunk();
    }
  });
}
