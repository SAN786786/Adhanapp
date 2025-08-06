class PrayerTimesCalculator {
    constructor() {
        console.log('PrayerTimesCalculator initialized');
        this.methodParams = {
            'MWL': { fajrAngle: 18, ishaAngle: 17 },
            'ISNA': { fajrAngle: 15, ishaAngle: 15 },
            'Egypt': { fajrAngle: 19.5, ishaAngle: 17.5 },
            'Makkah': { fajrAngle: 18.5, ishaAngle: 90 },
            'Karachi': { fajrAngle: 18, ishaAngle: 18 },
            'Tehran': { fajrAngle: 17.7, ishaAngle: 14 }
        };
    }

    calculatePrayerTimes(date, latitude, longitude, timezone, method = 'Karachi', madhab = 'Hanafi') {
        console.log('calculatePrayerTimes started:', { date, latitude, longitude, timezone, method, madhab });
        try {
            const julianDate = this.getJulianDate(date);
            const localTime = this.calculateSolarTime(julianDate, longitude, timezone);
            const times = {};

            const fajrAngle = this.methodParams[method]?.fajrAngle || 18;
            const ishaAngle = this.methodParams[method]?.ishaAngle || 18;
            const asrFactor = madhab === 'Hanafi' ? 2 : 1;

            times.fajr = this.calculateFajr(localTime, latitude, fajrAngle);
            times.sunrise = this.calculateSunrise(localTime, latitude);
            times.dhuhr = this.calculateDhuhr(localTime);
            times.asr = this.calculateAsr(localTime, latitude, asrFactor);
            times.maghrib = this.calculateMaghrib(localTime, latitude);
            times.isha = this.calculateIsha(localTime, latitude, ishaAngle);

            // Normalize times to 0-24 hours
            Object.keys(times).forEach(key => {
                times[key] = (times[key] % 24 + 24) % 24;
            });

            console.log('Calculated times:', times);
            return times;
        } catch (error) {
            console.error('Error in calculatePrayerTimes:', error);
            return {
                fajr: 0,
                sunrise: 0,
                dhuhr: 0,
                asr: 0,
                maghrib: 0,
                isha: 0
            };
        }
    }

    getJulianDate(date) {
        const year = date.getUTCFullYear();
        const month = date.getUTCMonth() + 1;
        const day = date.getUTCDate();
        const a = Math.floor((14 - month) / 12);
        const y = year + 4800 - a;
        const m = month + 12 * a - 3;
        return day + Math.floor((153 * m + 2) / 5) + 365 * y + Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400) - 32045;
    }

    calculateSolarTime(julianDate, longitude, timezone) {
        const D = julianDate - 2451545.0;
        const g = (357.529 + 0.98560028 * D) % 360;
        const q = (280.459 + 0.98564736 * D) % 360;
        const L = (q + 1.915 * Math.sin(g * Math.PI / 180) + 0.020 * Math.sin(2 * g * Math.PI / 180)) % 360;
        const e = 23.439 - 0.00000036 * D;
        const RA = Math.atan2(Math.cos(e * Math.PI / 180) * Math.sin(L * Math.PI / 180), Math.cos(L * Math.PI / 180)) * 180 / Math.PI / 15;
        const EqT = (q / 15 - RA) * 4 / 60;
        const longitudeHour = longitude / 15;
        const timezoneOffset = this.getTimezoneOffset(timezone) / 60;
        return 12 + EqT - longitudeHour + timezoneOffset;
    }

    getTimezoneOffset(timezone) {
        try {
            const date = new Date();
            const formatter = new Intl.DateTimeFormat('en-US', { timeZone: timezone, hour: 'numeric', minute: 'numeric' });
            const localTime = new Date(formatter.format(date));
            const utcTime = new Date(date.toLocaleString('en-US', { timeZone: 'UTC' }));
            return (localTime - utcTime) / 1000 / 60 / 60;
        } catch (error) {
            console.error('Error getting timezone offset:', error);
            return 5.5; // Default to Asia/Calcutta for Raichur
        }
    }

    calculateFajr(solarTime, latitude, fajrAngle) {
        const declination = this.calculateDeclination(solarTime);
        const cosAngle = -Math.sin(fajrAngle * Math.PI / 180) / (Math.cos(latitude * Math.PI / 180) * Math.cos(declination));
        if (Math.abs(cosAngle) > 1) return solarTime - 1.5;
        const hourAngle = Math.acos(cosAngle) * 180 / Math.PI;
        return solarTime - hourAngle / 15;
    }

    calculateSunrise(solarTime, latitude) {
        const declination = this.calculateDeclination(solarTime);
        const cosAngle = -Math.sin(0 * Math.PI / 180) / (Math.cos(latitude * Math.PI / 180) * Math.cos(declination));
        if (Math.abs(cosAngle) > 1) return solarTime;
        const hourAngle = Math.acos(cosAngle) * 180 / Math.PI;
        return solarTime - hourAngle / 15;
    }

    calculateDhuhr(solarTime) {
        return solarTime;
    }

    calculateAsr(solarTime, latitude, asrFactor) {
        const declination = this.calculateDeclination(solarTime);
        const tanAngle = Math.abs(Math.tan((latitude - declination * 180 / Math.PI) * Math.PI / 180));
        const shadowAngle = Math.atan(1 / (asrFactor + tanAngle));
        const cosAngle = (Math.sin(shadowAngle) - Math.sin(latitude * Math.PI / 180) * Math.sin(declination)) / (Math.cos(latitude * Math.PI / 180) * Math.cos(declination));
        if (Math.abs(cosAngle) > 1) return solarTime + 2;
        const hourAngle = Math.acos(cosAngle) * 180 / Math.PI;
        return solarTime + hourAngle / 15;
    }

    calculateMaghrib(solarTime, latitude) {
        const declination = this.calculateDeclination(solarTime);
        const cosAngle = -Math.sin(0 * Math.PI / 180) / (Math.cos(latitude * Math.PI / 180) * Math.cos(declination));
        if (Math.abs(cosAngle) > 1) return solarTime;
        const hourAngle = Math.acos(cosAngle) * 180 / Math.PI;
        return solarTime + hourAngle / 15;
    }

    calculateIsha(solarTime, latitude, ishaAngle) {
        const declination = this.calculateDeclination(solarTime);
        const cosAngle = -Math.sin(ishaAngle * Math.PI / 180) / (Math.cos(latitude * Math.PI / 180) * Math.cos(declination));
        if (Math.abs(cosAngle) > 1) return solarTime + 1.5;
        const hourAngle = Math.acos(cosAngle) * 180 / Math.PI;
        return solarTime + hourAngle / 15;
    }

    calculateDeclination(solarTime) {
        const D = (solarTime * 24 - 2451545.0);
        const g = (357.529 + 0.98560028 * D) % 360;
        const q = (280.459 + 0.98564736 * D) % 360;
        const L = (q + 1.915 * Math.sin(g * Math.PI / 180) + 0.020 * Math.sin(2 * g * Math.PI / 180)) % 360;
        const e = 23.439 - 0.00000036 * D;
        return Math.asin(Math.sin(e * Math.PI / 180) * Math.sin(L * Math.PI / 180)) * 180 / Math.PI;
    }

    formatTime(decimalTime) {
        if (!decimalTime || isNaN(decimalTime)) {
            console.warn('Invalid decimal time:', decimalTime);
            return 'Error';
        }
        const hours = Math.floor(decimalTime);
        const minutes = Math.floor((decimalTime - hours) * 60);
        const period = hours >= 12 ? 'PM' : 'AM';
        const displayHours = hours % 12 || 12;
        return `${displayHours}:${minutes.toString().padStart(2, '0')} ${period}`;
    }

    formatCountdown(hours) {
        const totalMinutes = Math.floor(hours * 60);
        const h = Math.floor(totalMinutes / 60);
        const m = totalMinutes % 60;
        return `${h} hours ${m} minutes`;
    }
}

window.PrayerTimesCalculator = PrayerTimesCalculator;