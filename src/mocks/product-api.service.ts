import { Injectable } from '@nestjs/common';

export interface Product {
    id: string;
    name: string;
    price: number;
    stock: string;
    description: string;
}

export interface ProductQueryResult {
    source: string;
    products: Product[];
}

@Injectable()
export class ProductApiService {
    private readonly products: Product[] = [
        { id: 'p1', name: 'Premium Brake Pads', price: 59.99, stock: 'In Stock', description: 'High performance ceramic brake pads.' },
        { id: 'p2', name: 'Standard Oil Filter', price: 12.99, stock: 'In Stock', description: 'Fits most sedans.' },
        { id: 'p3', name: 'Synthetic Motor Oil 5W-30', price: 29.99, stock: 'Low Stock', description: 'Full synthetic for better protection.' },
        { id: 'p4', name: 'Wiper Blades (Pair)', price: 24.99, stock: 'Out of Stock', description: 'All-season wiper blades.' },
    ];

    searchProducts(query: string): ProductQueryResult | string {
        const normalizedQuery = query.toLowerCase();

        const matches = this.products.filter(p =>
            normalizedQuery.includes(p.name.toLowerCase()) ||
            normalizedQuery.includes(p.description.toLowerCase()) ||
            (normalizedQuery.includes('brake') && p.name.toLowerCase().includes('brake')) ||
            (normalizedQuery.includes('oil') && p.name.toLowerCase().includes('oil'))
        );

        if (matches.length === 0) {
            return "Product API: No matching products found for the query.";
        }

        return {
            source: 'mock_product_api',
            products: matches
        };
    }
}
