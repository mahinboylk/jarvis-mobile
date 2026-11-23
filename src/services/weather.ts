import { fetch as expoFetch } from 'expo/fetch';
import { OPEN_METEO, TIMEOUTS } from '../config/models';
import { withTimeout } from '../utils/async';
import { connectivity } from './connectivity';

export interface WeatherResult {
  location: string;
  temperatureC: number;
  apparentC: number;
  windKph: number;
  humidity: number;
  condition: string;
  /** Ready-to-speak sentence. */
  summary: string;
}

/** WMO weather interpretation codes → spoken phrases. */
const WMO_CODES: Record<number, string> = {
  0: 'clear skies',
  1: 'mainly clear skies',
  2: 'partly cloudy skies',
  3: 'overcast skies',
  45: 'fog',
  48: 'depositing rime fog',
  51: 'light drizzle',
  53: 'moderate drizzle',
  55: 'dense drizzle',
  56: 'light freezing drizzle',
  57: 'dense freezing drizzle',
  61: 'light rain',
  63: 'moderate rain',
  65: 'heavy rain',
  66: 'light freezing rain',
  67: 'heavy freezing rain',
  71: 'light snowfall',
  73: 'moderate snowfall',
  75: 'heavy snowfall',
  77: 'snow grains',
  80: 'light rain showers',
  81: 'moderate rain showers',
  82: 'violent rain showers',
  85: 'light snow showers',
  86: 'heavy snow showers',
  95: 'a thunderstorm',
  96: 'a thunderstorm with light hail',
  99: 'a thunderstorm with heavy hail',
};

/**
 * Best-effort city name from the device timezone, so "what's the weather?"
 * with no location still resolves somewhere sensible.
 */
export function cityFromTimezone(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    const parts = tz.split('/');
    const city = parts[parts.length - 1] || '';
    return city.replace(/_/g, ' ').trim();
  } catch {
    return '';
  }
}

interface GeocodeHit {
  name: string;
  latitude: number;
  longitude: number;
  country?: string;
  admin1?: string;
}

export async function getWeather(location?: string): Promise<WeatherResult> {
  const query = (location || '').trim() || cityFromTimezone();
  if (!query) {
    throw new Error('I need a location to check the weather, sir.');
  }

  const geoUrl = `${OPEN_METEO.GEOCODE}?name=${encodeURIComponent(query)}&count=1&language=en&format=json`;
  try {
    const geoRes = await withTimeout(
      expoFetch(geoUrl, { headers: { 'User-Agent': 'jarvis-mobile/1.0' } }),
      TIMEOUTS.WEATHER_TIMEOUT_MS,
      'Weather lookup'
    );
    if (!geoRes.ok) throw new Error(`Geocoding failed (${geoRes.status}).`);
    const geoData = await geoRes.json();
    const hit: GeocodeHit | undefined = geoData?.results?.[0];
    if (!hit) throw new Error(`I could not find a place called ${query}, sir.`);

    const forecastUrl =
      `${OPEN_METEO.FORECAST}?latitude=${hit.latitude}&longitude=${hit.longitude}` +
      '&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code' +
      '&wind_speed_unit=kmh&timezone=auto';

    const res = await withTimeout(
      expoFetch(forecastUrl),
      TIMEOUTS.WEATHER_TIMEOUT_MS,
      'Weather lookup'
    );
    if (!res.ok) throw new Error(`Weather service returned ${res.status}.`);
    const data = await res.json();
    const current = data?.current;
    if (!current) throw new Error('Weather service returned no current conditions.');

    connectivity.reportSuccess();

    const temperatureC = Math.round(Number(current.temperature_2m));
    const apparentC = Math.round(Number(current.apparent_temperature));
    const windKph = Math.round(Number(current.wind_speed_10m));
    const humidity = Math.round(Number(current.relative_humidity_2m));
    const condition = WMO_CODES[Number(current.weather_code)] ?? 'indeterminate conditions';
    const place = hit.admin1 && hit.admin1 !== hit.name ? `${hit.name}, ${hit.admin1}` : hit.name;

    const feels =
      Math.abs(apparentC - temperatureC) >= 2 ? `, feeling closer to ${apparentC}` : '';

    return {
      location: place,
      temperatureC,
      apparentC,
      windKph,
      humidity,
      condition,
      summary: `In ${place} it is currently ${temperatureC} degrees with ${condition}${feels}. Wind is ${windKph} kilometres per hour and humidity is ${humidity} percent.`,
    };
  } catch (e) {
    connectivity.reportFailure(e);
    throw e;
  }
}
