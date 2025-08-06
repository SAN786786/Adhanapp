/**
 * Main Application Controller
 * Adhan App - Classic Prayer Times
 */

class AdhanApp {
    constructor() {
        console.log('AdhanApp constructor started');
        try {
            if (typeof PrayerTimesCalculator === 'undefined') {
                console.error('PrayerTimesCalculator is undefined. Ensure prayer-times.js is loaded.');
                throw new Error('PrayerTimesCalculator not found');
            }
            this.calculator = new PrayerTimesCalculator();
            this.currentLocation = null;
            this.settings = {
                method: 'Karachi',
                madhab: 'Hanafi',
                location: null
            };
            this.qiblaDirection = 0;
            this.isQiblaViewActive = false;
            this.touchStartX = 0;
            this.isVibrating = false; 

            // Bind 'this' for event handlers
            this.handleOrientation = this.handleOrientation.bind(this);
            this.handleTouchStart = this.handleTouchStart.bind(this);
            this.handleTouchEnd = this.handleTouchEnd.bind(this);

            console.log('AdhanApp constructor completed');
        } catch (error) {
            console.error('Constructor error:', error);
            this.handleError('Failed to initialize app. Check console for details.');
        }
    }

    async init() {
        console.log('AdhanApp init started');
        try {
            await this.loadSettings();
            await this.getLocation();
            this.setupEventListeners();
            this.setupSwipeListeners();
            this.updateLiveTime();
            this.startClock();
            await this.calculateAndDisplayTimes();
            this.calculateQiblaDirection();
        } catch (error) {
            console.error('Initialization failed:', error);
            this.handleError('Initialization failed. Please check network or location settings.');
        }
        console.log('AdhanApp init completed');
    }

    async loadSettings() {
        try {
            const saved = localStorage.getItem('adhanSettings');
            if (saved) {
                this.settings = JSON.parse(saved);
            }
        } catch (error) {
            console.error('Error loading settings:', error);
        }
    }

    async saveSettings() {
        try {
            localStorage.setItem('adhanSettings', JSON.stringify(this.settings));
        } catch (error) {
            console.error('Error saving settings:', error);
        }
    }

    async getLocation(maxRetries = 2) {
        try {
            if (!navigator.geolocation) {
                this.setDefaultLocation();
                return true;
            }

            let retries = 0;
            while (retries <= maxRetries) {
                try {
                    const position = await new Promise((resolve, reject) => {
                        navigator.geolocation.getCurrentPosition(resolve, reject, {
                            enableHighAccuracy: true,
                            timeout: 5000,
                            maximumAge: 0
                        });
                    });

                    const { latitude, longitude } = position.coords;
                    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Riyadh';
                    
                    let city = 'Your Location';
                    try {
                        const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}`, {
                            headers: { 'User-Agent': 'AdhanApp/1.0' }
                        });
                        const data = await response.json();
                        city = data.address?.city || data.address?.town || data.address?.state || 'Your Location';
                    } catch (error) {
                        console.error('Error getting city name:', error);
                    }

                    this.currentLocation = { latitude, longitude, timezone, city };
                    this.settings.location = { latitude, longitude, timezone, city };
                    await this.saveSettings();
                    document.getElementById('location').textContent = city;
                    return true;
                } catch (error) {
                    console.error(`Location attempt ${retries + 1} failed:`, error);
                    retries++;
                    if (retries > maxRetries) {
                        this.setDefaultLocation();
                        return true;
                    }
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            }
        } catch (error) {
            console.error('getLocation error:', error);
            this.setDefaultLocation();
            return true;
        }
        return false;
    }

    setDefaultLocation() {
        this.currentLocation = {
            latitude: 21.4225,
            longitude: 39.8262,
            timezone: 'Asia/Riyadh',
            city: 'Makkah'
        };
        this.settings.location = this.currentLocation;
        document.getElementById('location').textContent = 'Makkah';
        this.saveSettings();
    }

    async calculateAndDisplayTimes() {
        if (!this.currentLocation) {
            this.handleError('No location available');
            return;
        }

        try {
            const timings = await this.getAccuratePrayerTimes();
            if (!timings) {
                await this.calculateLocalPrayerTimes();
                return;
            }

            const prayerElements = {
                fajr: 'fajr-time', sunrise: 'sunrise-time', dhuhr: 'dhuhr-time',
                asr: 'asr-time', maghrib: 'maghrib-time', isha: 'isha-time'
            };

            Object.keys(prayerElements).forEach(prayer => {
                const element = document.getElementById(prayerElements[prayer]);
                if (element && timings[prayer]) {
                    element.textContent = this.formatApiTime(timings[prayer]);
                } else {
                    element.textContent = 'Error';
                }
            });

            const apiTimes = {
                fajr: this.convertTimeToDecimal(timings.fajr) || 0,
                sunrise: this.convertTimeToDecimal(timings.sunrise) || 0,
                dhuhr: this.convertTimeToDecimal(timings.dhuhr) || 0,
                asr: this.convertTimeToDecimal(timings.asr) || 0,
                maghrib: this.convertTimeToDecimal(timings.maghrib) || 0,
                isha: this.convertTimeToDecimal(timings.isha) || 0
            };

            if (Object.values(apiTimes).some(time => isNaN(time))) {
                await this.calculateLocalPrayerTimes();
                return;
            }

            this.updateCurrentAndNextPrayer(apiTimes);
            await this.updateDates();
        } catch (error) {
            console.error('Error in calculateAndDisplayTimes:', error);
            await this.calculateLocalPrayerTimes();
        }
    }

    getAladhanMethod(method) {
        const methodMap = { 'MWL': 3, 'ISNA': 2, 'Egypt': 5, 'Makkah': 4, 'Karachi': 1, 'Tehran': 7 };
        return methodMap[method] || 1;
    }

    async getAccuratePrayerTimes(maxRetries = 2) {
        if (!this.currentLocation) return null;

        let retries = 0;
        while (retries <= maxRetries) {
            try {
                const now = new Date();
                const dateStr = now.toISOString().split('T')[0];
                const apiUrl = `https://api.aladhan.com/v1/timings/${dateStr}?latitude=${this.currentLocation.latitude}&longitude=${this.currentLocation.longitude}&method=${this.getAladhanMethod(this.settings.method)}&timezonestring=${this.currentLocation.timezone}&school=${this.settings.madhab === 'Hanafi' ? 1 : 0}`;
                const response = await fetch(apiUrl, { signal: AbortSignal.timeout(10000) });
                const data = await response.json();
                if (data.code === 200 && data.data && data.data.timings) {
                    return this.validateAndAdjustTimes(data.data.timings);
                }
                throw new Error('Invalid API response');
            } catch (error) {
                console.error(`Prayer times API attempt ${retries + 1} failed:`, error);
                retries++;
                if (retries > maxRetries) return null;
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
        return null;
    }

    validateAndAdjustTimes(timings) {
        const prayers = ['fajr', 'sunrise', 'dhuhr', 'asr', 'maghrib', 'isha'];
        const validated = {};
        let prevTime = -1;

        for (const prayer of prayers) {
            const timeStr = timings[prayer] || timings[prayer.charAt(0).toUpperCase() + prayer.slice(1)];
            if (timeStr && this.isValidTimeFormat(timeStr)) {
                const time = this.convertTimeToDecimal(timeStr);
                if (!isNaN(time) && time > prevTime) {
                    validated[prayer] = timeStr;
                    prevTime = time;
                } else {
                    validated[prayer] = this.calculateFallbackTime(prayer);
                }
            } else {
                validated[prayer] = this.calculateFallbackTime(prayer);
            }
        }
        return validated;
    }

    isValidTimeFormat(timeStr) {
        return /^(\d{1,2}):(\d{2})$/.test(timeStr) || /^(\d{1,2}):(\d{2})\s?(AM|PM)$/i.test(timeStr);
    }

    calculateFallbackTime(prayer) {
        try {
            const times = this.calculator.calculatePrayerTimes(
                new Date(),
                this.currentLocation.latitude,
                this.currentLocation.longitude,
                this.currentLocation.timezone,
                this.settings.method,
                this.settings.madhab
            );
            return this.calculator.formatTime(times[prayer] || 0);
        } catch (error) {
            console.error(`Fallback calculation failed for ${prayer}:`, error);
            return 'Error';
        }
    }

    formatApiTime(timeStr) {
        if (!timeStr) return 'Error';
        let hours, minutes, period;
        if (/^(\d{1,2}):(\d{2})$/.test(timeStr)) {
            [hours, minutes] = timeStr.split(':').map(Number);
            period = hours >= 12 ? 'PM' : 'AM';
            hours = hours % 12 || 12;
        } else if (/^(\d{1,2}):(\d{2})\s?(AM|PM)$/i.test(timeStr)) {
            const match = timeStr.match(/^(\d{1,2}):(\d{2})\s?(AM|PM)$/i);
            hours = parseInt(match[1], 10);
            minutes = parseInt(match[2], 10);
            period = match[3].toUpperCase();
        } else {
            return 'Error';
        }
        if (isNaN(hours) || isNaN(minutes) || hours > 12 || minutes > 59) return 'Error';
        return `${hours}:${minutes.toString().padStart(2, '0')} ${period}`;
    }

    convertTimeToDecimal(timeStr) {
        if (!timeStr || typeof timeStr !== 'string') return 0;
        let hours, minutes;
        if (/^(\d{1,2}):(\d{2})$/.test(timeStr)) {
            [hours, minutes] = timeStr.split(':').map(Number);
        } else if (/^(\d{1,2}):(\d{2})\s?(AM|PM)$/i.test(timeStr)) {
            const match = timeStr.match(/^(\d{1,2}):(\d{2})\s?(AM|PM)$/i);
            hours = parseInt(match[1], 10);
            minutes = parseInt(match[2], 10);
            const period = match[3].toUpperCase();
            if (period === 'PM' && hours !== 12) hours += 12;
            if (period === 'AM' && hours === 12) hours = 0;
        } else {
            return 0;
        }
        if (isNaN(hours) || isNaN(minutes)) return 0;
        return hours + (minutes / 60);
    }

    async calculateLocalPrayerTimes() {
        if (!this.currentLocation) {
            this.handleError('No location for local calculation');
            return;
        }
        try {
            const times = this.calculator.calculatePrayerTimes(
                new Date(), this.currentLocation.latitude, this.currentLocation.longitude,
                this.currentLocation.timezone, this.settings.method, this.settings.madhab
            );
            const prayerElements = {
                fajr: 'fajr-time', sunrise: 'sunrise-time', dhuhr: 'dhuhr-time',
                asr: 'asr-time', maghrib: 'maghrib-time', isha: 'isha-time'
            };
            Object.keys(prayerElements).forEach(prayer => {
                const element = document.getElementById(prayerElements[prayer]);
                if (element && times[prayer] && !isNaN(times[prayer])) {
                    element.textContent = this.calculator.formatTime(times[prayer]);
                } else {
                    element.textContent = 'Error';
                }
            });
            this.updateCurrentAndNextPrayer(times);
            await this.updateDates();
        } catch (error) {
            console.error('Error in local prayer time calculation:', error);
            this.handleError('Calculation failed');
        }
    }

    updateCurrentAndNextPrayer(times) {
        try {
            const now = new Date();
            const currentTime = now.getHours() + now.getMinutes() / 60;
            const prayers = [
                { name: 'Fajr', time: times.fajr }, { name: 'Sunrise', time: times.sunrise },
                { name: 'Dhuhr', time: times.dhuhr }, { name: 'Asr', time: times.asr },
                { name: 'Maghrib', time: times.maghrib }, { name: 'Isha', time: times.isha }
            ];
            let currentPrayer = prayers[prayers.length - 1];
            let nextPrayer = prayers[0];
            let nextTime = (prayers[0]?.time || 0) + 24;

            for (let i = 0; i < prayers.length; i++) {
                if (currentTime < (prayers[i]?.time || 0)) {
                    nextPrayer = prayers[i];
                    nextTime = prayers[i].time;
                    currentPrayer = i > 0 ? prayers[i - 1] : prayers[prayers.length - 1];
                    break;
                }
            }
            
            document.getElementById('current-prayer-name').textContent = currentPrayer.name;
            document.getElementById('current-prayer-time').textContent = this.calculator.formatTime(currentPrayer.time);
            let remaining = nextTime - currentTime;
            if (remaining < 0) remaining += 24;
            document.getElementById('countdown').textContent = `Next prayer in ${this.formatCountdown(remaining)}`;
        } catch (error) {
            console.error('Error updating current/next prayer:', error);
            this.handleError('Prayer time update failed');
        }
    }

    formatCountdown(hours) {
        const totalMinutes = Math.floor(hours * 60);
        const h = Math.floor(totalMinutes / 60);
        const m = totalMinutes % 60;
        return `${h} hours ${m} minutes`;
    }

    async updateDates() {
        try {
            const now = new Date();
            const gregorian = now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
            document.getElementById('gregorian-date').textContent = gregorian;
            
            const dateStr = now.toISOString().split('T')[0];
            let hijriDate = null;
            try {
                const response = await fetch(`https://api.aladhan.com/v1/gToH/${dateStr}`, { signal: AbortSignal.timeout(10000) });
                const data = await response.json();
                if (data.code === 200 && data.data && data.data.hijri) {
                    hijriDate = data.data.hijri;
                }
            } catch (error) {
                console.error('Error fetching Hijri date from API:', error);
            }

            const hijriElement = document.getElementById('hijri-date');
            if (hijriDate?.day && hijriDate?.month && hijriDate?.year) {
                hijriElement.textContent = `${hijriDate.day} ${hijriDate.month.en} ${hijriDate.year} AH`;
            } else {
                hijriElement.textContent = this.calculateLocalHijriDate(now);
            }
        } catch (error) {
            console.error('Error in updateDates:', error);
            document.getElementById('hijri-date').textContent = this.calculateLocalHijriDate(new Date());
            document.getElementById('gregorian-date').textContent = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
        }
    }

    calculateLocalHijriDate(date) {
        try {
            const jd = this.getJulianDate(date);
            const islamicEpoch = 1948439.5;
            const daysSinceEpoch = Math.floor(jd - islamicEpoch) + 1;
            const thirtyYearCycles = Math.floor(daysSinceEpoch / 10631);
            const remainingDaysAfterCycles = daysSinceEpoch % 10631;
            const leapYearsIn30 = [2, 5, 7, 10, 13, 16, 18, 21, 24, 26, 29];
            let yearInCycle = 0;
            let daysLeft = remainingDaysAfterCycles;
            for (let y = 1; y <= 30; y++) {
                const isLeap = leapYearsIn30.includes(y);
                const daysInYear = isLeap ? 355 : 354;
                if (daysLeft < daysInYear) {
                    yearInCycle = y;
                    break;
                }
                daysLeft -= daysInYear;
            }
            if (yearInCycle === 0) yearInCycle = 30;
            const hijriYear = thirtyYearCycles * 30 + yearInCycle;
            const currentYearIsLeap = leapYearsIn30.includes(yearInCycle);
            const islamicMonths = [
                { name: 'Muharram', days: 30 }, { name: 'Safar', days: 29 },
                { name: 'Rabi al-Awwal', days: 30 }, { name: 'Rabi al-Thani', days: 29 },
                { name: 'Jumada al-Awwal', days: 30 }, { name: 'Jumada al-Thani', days: 29 },
                { name: 'Rajab', days: 30 }, { name: 'Shaban', days: 29 },
                { name: 'Ramadan', days: 30 }, { name: 'Shawwal', days: 29 },
                { name: 'Dhu al-Qidah', days: 30 }, { name: 'Dhu al-Hijjah', days: currentYearIsLeap ? 30 : 29 }
            ];
            let monthIndex = 0;
            for (let m = 0; m < 12; m++) {
                if (daysLeft < islamicMonths[m].days) {
                    monthIndex = m;
                    break;
                }
                daysLeft -= islamicMonths[m].days;
            }
            const hijriDay = Math.floor(daysLeft) + 1;
            return `${hijriDay} ${islamicMonths[monthIndex].name} ${hijriYear} AH`;
        } catch (error) {
            console.error('Error calculating Hijri date:', error);
            return 'Hijri Date Unavailable';
        }
    }

    getJulianDate(date) {
        const year = date.getUTCFullYear();
        const month = date.getUTCMonth() + 1;
        const day = date.getUTCDate();
        let a = Math.floor((14 - month) / 12);
        let y = year + 4800 - a;
        let m = month + 12 * a - 3;
        return day + Math.floor((153 * m + 2) / 5) + 365 * y + Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400) - 32045.5;
    }

    handleError(message) {
        console.error('handleError:', message);
        const ids = ['fajr-time', 'sunrise-time', 'dhuhr-time', 'asr-time', 'maghrib-time', 'isha-time', 'current-prayer-name', 'current-prayer-time'];
        ids.forEach(id => {
            const el = document.getElementById(id);
            if(el) el.textContent = 'Error';
        });
        const cd = document.getElementById('countdown');
        if(cd) cd.textContent = message;
        const loc = document.getElementById('location');
        if(loc) loc.textContent = this.currentLocation?.city || 'Error';
    }

    startClock() {
        this.updateLiveTime();
        setInterval(() => this.updateLiveTime(), 1000);
        setInterval(() => this.calculateAndDisplayTimes(), 60000);
    }

    updateLiveTime() {
        try {
            const liveTimeElement = document.getElementById('live-time');
            if (liveTimeElement) {
                liveTimeElement.textContent = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
            }
        } catch (error) {
            console.error('Error updating live time:', error);
        }
    }

    setupEventListeners() {
        const settingsBtn = document.getElementById('settingsBtn');
        const settingsModal = document.getElementById('settingsModal');
        const closeBtn = document.querySelector('.close');
        const saveBtn = document.getElementById('saveSettings');
        const permissionBtn = document.getElementById('permission-btn');
        const qiblaBtn = document.getElementById('qiblaBtn');
        const backBtn = document.getElementById('backBtn');

        if (settingsBtn) settingsBtn.addEventListener('click', () => {
            if (settingsModal) {
                settingsModal.style.display = 'block';
                this.populateSettings();
            }
        });
        if (qiblaBtn) qiblaBtn.addEventListener('click', () => this.activateQiblaFinder());
        if (backBtn) backBtn.addEventListener('click', () => this.deactivateQiblaFinder());
        if (closeBtn) closeBtn.addEventListener('click', () => {
            if (settingsModal) settingsModal.style.display = 'none';
        });
        if (saveBtn) saveBtn.addEventListener('click', async () => {
            await this.saveSettingsFromModal();
            if (settingsModal) settingsModal.style.display = 'none';
            await this.getLocation();
            await this.calculateAndDisplayTimes();
            this.calculateQiblaDirection();
        });
        if (permissionBtn) permissionBtn.addEventListener('click', () => this.requestOrientationPermission());
        window.addEventListener('click', (event) => {
            if (event.target === settingsModal) {
                settingsModal.style.display = 'none';
            }
        });
    }

    setupSwipeListeners() {
        const swipeContainer = document.querySelector('.swipe-container');
        swipeContainer.addEventListener('touchstart', this.handleTouchStart, { passive: true });
        swipeContainer.addEventListener('touchend', this.handleTouchEnd, { passive: true });
    }

    handleTouchStart(event) {
        this.touchStartX = event.changedTouches[0].clientX;
    }

    handleTouchEnd(event) {
        const touchEndX = event.changedTouches[0].clientX;
        const swipeDistance = this.touchStartX - touchEndX;
        if (Math.abs(swipeDistance) < 50) return;
        if (swipeDistance > 0 && !this.isQiblaViewActive) {
            this.activateQiblaFinder();
        } else if (swipeDistance < 0 && this.isQiblaViewActive) {
            this.deactivateQiblaFinder();
        }
    }

    activateQiblaFinder() {
        this.isQiblaViewActive = true;
        document.querySelector('.swipe-container').classList.add('qibla-active');
        this.requestOrientationPermission();
    }

    deactivateQiblaFinder() {
        this.isQiblaViewActive = false;
        document.querySelector('.swipe-container').classList.remove('qibla-active');
        window.removeEventListener('deviceorientation', this.handleOrientation);
        document.getElementById('qibla-found-message').classList.remove('visible');
        document.querySelector('.compass-dial').classList.remove('aligned');
    }

    async requestOrientationPermission() {
        const permissionBtn = document.getElementById('permission-btn');
        if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
            try {
                const permission = await DeviceOrientationEvent.requestPermission();
                if (permission === 'granted') {
                    window.addEventListener('deviceorientation', this.handleOrientation);
                    if (permissionBtn) permissionBtn.style.display = 'none';
                } else {
                    if (permissionBtn) permissionBtn.style.display = 'block';
                }
            } catch (error) {
                if (permissionBtn) permissionBtn.style.display = 'block';
            }
        } else {
            window.addEventListener('deviceorientation', this.handleOrientation);
            if (permissionBtn) permissionBtn.style.display = 'none';
        }
    }

    calculateQiblaDirection() {
        if (!this.currentLocation) return;
        const kaabaLat = 21.4225 * Math.PI / 180;
        const kaabaLon = 39.8262 * Math.PI / 180;
        const userLat = this.currentLocation.latitude * Math.PI / 180;
        const userLon = this.currentLocation.longitude * Math.PI / 180;
        const lonDiff = kaabaLon - userLon;
        const y = Math.sin(lonDiff);
        const x = Math.cos(userLat) * Math.tan(kaabaLat) - Math.sin(userLat) * Math.cos(lonDiff);
        this.qiblaDirection = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
        document.getElementById('qibla-direction-text').textContent = `Qibla: ${this.qiblaDirection.toFixed(1)}° from North`;
    }

    handleOrientation(event) {
        // **NEW:** Check if compass data is available
        if (event.alpha === null && typeof event.webkitCompassHeading === 'undefined') {
            this.showCompassError();
            return;
        }

        if (!this.isQiblaViewActive) return;

        const pointer = document.getElementById('compass-pointer');
        const msg = document.getElementById('qibla-found-message');
        const dial = document.querySelector('.compass-dial');
        if (!pointer || !msg || !dial) return;

        const heading = event.webkitCompassHeading || (360 - event.alpha);
        const rotation = this.qiblaDirection - heading;
        pointer.style.transform = `rotate(${rotation}deg)`;

        const isAligned = Math.abs(rotation % 360) < 2 || Math.abs(rotation % 360) > 358;
        if (isAligned) {
            msg.classList.add('visible');
            dial.classList.add('aligned');
            if (!this.isVibrating) {
                if ('vibrate' in navigator) navigator.vibrate(100);
                this.isVibrating = true;
            }
        } else {
            msg.classList.remove('visible');
            dial.classList.remove('aligned');
            this.isVibrating = false;
        }
    }
    
    // **NEW:** Function to show an error when the compass is unavailable
    showCompassError() {
        // Remove the listener so this doesn't keep firing
        window.removeEventListener('deviceorientation', this.handleOrientation);
        
        const dirText = document.getElementById('qibla-direction-text');
        const pointer = document.getElementById('compass-pointer');

        if(dirText) {
            dirText.innerHTML = "Compass not available on this device.<br>Please try on a mobile phone.";
        }
        if(pointer) {
            pointer.style.display = 'none'; // Hide the pointer
        }
    }

    populateSettings() {
        try {
            document.getElementById('methodSelect').value = this.settings.method;
            document.getElementById('madhabSelect').value = this.settings.madhab;
            document.getElementById('locationInput').value = this.currentLocation?.city || '';
        } catch (error) {
            console.error('Error populating settings:', error);
        }
    }

    async saveSettingsFromModal() {
        try {
            this.settings.method = document.getElementById('methodSelect').value;
            this.settings.madhab = document.getElementById('madhabSelect').value;
            const locationInput = document.getElementById('locationInput');
            if (locationInput && locationInput.value && locationInput.value !== this.currentLocation?.city) {
                try {
                    const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(locationInput.value)}&limit=1`);
                    const data = await response.json();
                    if (data && data[0]) {
                        const { lat, lon } = data[0];
                        const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Riyadh';
                        this.currentLocation = { latitude: parseFloat(lat), longitude: parseFloat(lon), timezone, city: locationInput.value };
                        this.settings.location = this.currentLocation;
                        document.getElementById('location').textContent = locationInput.value;
                    } else {
                        alert('City not found. Keeping current location.');
                    }
                } catch (error) {
                    alert('Error finding city. Keeping current location.');
                }
            }
            await this.saveSettings();
        } catch (error) {
            console.error('Error saving settings from modal:', error);
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    try {
        const app = new AdhanApp();
        app.init();
    } catch (error) {
        console.error('Error starting AdhanApp:', error);
    }
});