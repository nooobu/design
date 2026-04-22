// Claude tool_use definitions for the trip planning agent

export const TOOLS = [
  {
    name: 'plan_complete_trip',
    description: 'Plan a complete road trip: route, charging stops, rest areas (道の駅/SA/PA). Call this when the user provides departure and destination.',
    input_schema: {
      type: 'object',
      properties: {
        departure: {
          type: 'string',
          description: 'Departure location (city, address, or landmark name). e.g. "東京駅", "渋谷"',
        },
        destination: {
          type: 'string',
          description: 'Destination location. e.g. "大阪", "京都駅"',
        },
        start_charge_percent: {
          type: 'number',
          description: 'Current battery charge percentage (0-100). Default 80 if unknown.',
          default: 80,
        },
        departure_time: {
          type: 'string',
          description: 'Planned departure time in ISO format or natural language. e.g. "2025-01-15T08:00", "明日朝8時"',
        },
        passengers: {
          type: 'string',
          description: 'Description of passengers. e.g. "家族4人（子供2人）", "カップル"',
        },
      },
      required: ['departure', 'destination'],
    },
  },
  {
    name: 'find_rest_stops',
    description: 'Find 道の駅 (Michi-no-Eki road stations) and highway SA/PA (service/parking areas) near a point or along the current route. Use for follow-up questions about specific rest areas.',
    input_schema: {
      type: 'object',
      properties: {
        lat: {
          type: 'number',
          description: 'Latitude to search near',
        },
        lng: {
          type: 'number',
          description: 'Longitude to search near',
        },
        radius_km: {
          type: 'number',
          description: 'Search radius in km. Default 30.',
          default: 30,
        },
        filter: {
          type: 'string',
          enum: ['all', 'michinoeki', 'sa_pa'],
          description: 'Filter by type. Default "all".',
          default: 'all',
        },
      },
      required: ['lat', 'lng'],
    },
  },
  {
    name: 'find_ev_chargers',
    description: 'Find EV charging stations near a specific location. Use when the user asks about charging near a specific area.',
    input_schema: {
      type: 'object',
      properties: {
        lat: {
          type: 'number',
          description: 'Latitude to search near',
        },
        lng: {
          type: 'number',
          description: 'Longitude to search near',
        },
        radius_km: {
          type: 'number',
          description: 'Search radius in km. Default 15.',
          default: 15,
        },
      },
      required: ['lat', 'lng'],
    },
  },
]
