import { Injectable } from '@nestjs/common';

export interface StoreLocation {
    id: string;
    name: string;
    address: string;
    phone: string;
    hours: string;
}

export interface LocationQueryResult {
    source: string;
    locations: StoreLocation[];
}

@Injectable()
export class LocationApiService {
    private readonly locations: StoreLocation[] = [
        {
            id: 'l1',
            name: 'Kota Damansara',
            address: 'No.2-G (Ground Floor) Jalan PJU 5/20D, The Strand Kota Damansara, 47810 Petaling Jaya, Selangor',
            phone: '010-203 0291',
            hours: '9:15am - 6:00pm (Mon-Sat), 9:15am - 4:30pm (Sun)'
        },
        {
            id: 'l2',
            name: 'Ampang Jaya',
            address: 'No. 45, Jln Ulu Klang, Ukay Heights, 68000 Ampang, Selangor',
            phone: '011-12784255',
            hours: '9:15am - 6:00pm (Mon-Sat), 9:15am - 4:30pm (Sun)'
        },
        {
            id: 'l3',
            name: 'Subang Jaya',
            address: 'Lot PT 2092, Jalan Tujuan, Subang Jaya, 47500, Selangor',
            phone: '03-56372188',
            hours: '9:15am - 6:00pm (Mon-Sat), 9:15am - 4:30pm (Sun)'
        },
        {
            id: 'l4',
            name: 'Sentul',
            address: 'No. 2, Lorong Sentul Kecil Off Jalan Sentul, 51100 Kuala Lumpur',
            phone: '03-4042 9797',
            hours: '9:15am - 6:00pm (Mon-Sat), 9:15am - 4:30pm (Sun)'
        },
        {
            id: 'l5',
            name: 'TTDI',
            address: 'Lot 41313, Pinggir Zaaba, Taman Tun Dr. Ismail, 60000 Kuala Lumpur',
            phone: '03-7727 7377',
            hours: '9:15am - 6:00pm (Mon-Sat), 9:15am - 4:30pm (Sun)'
        },
        {
            id: 'l6',
            name: 'Seremban 2',
            address: 'No. 124, Jalan S2 B20, Pusat Dagangan Seremban 2, 70300 Seremban, Negeri Sembilan',
            phone: '06-601 3877',
            hours: '9:15am - 6:00pm (Mon-Sat), 9:15am - 4:30pm (Sun)'
        }
    ];

    searchLocations(query: string): LocationQueryResult | string {
        const normalizedQuery = query.toLowerCase();

        // 1. Try specific matching first
        const matches = this.locations.filter(l =>
            normalizedQuery.includes(l.name.toLowerCase()) ||
            normalizedQuery.includes(l.address.toLowerCase()) ||
            (normalizedQuery.includes('selangor') && l.address.toLowerCase().includes('selangor')) ||
            (normalizedQuery.includes('kuala lumpur') && l.address.toLowerCase().includes('kuala lumpur')) ||
            (normalizedQuery.includes('kl') && l.address.toLowerCase().includes('kuala lumpur'))
        );

        if (matches.length > 0) {
            return {
                source: 'mock_location_api',
                locations: matches
            };
        }

        // 2. Fallback to generic queries if no specific match found
        if (
            normalizedQuery.includes('store') ||
            normalizedQuery.includes('location') ||
            normalizedQuery.includes('branch') ||
            normalizedQuery.includes('near')
        ) {
            return {
                source: 'mock_location_api',
                locations: this.locations
            };
        }

        return "Location API: No matching stores found for the query.";
    }
}
