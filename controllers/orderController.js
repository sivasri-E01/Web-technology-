// aurachef-backend/controllers/orderController.js

export const simulateOrder = async (req, res) => {
    try {
        const items = Array.isArray(req.body?.items) ? req.body.items.filter(i => typeof i === 'string' && i.trim()) : [];
        if (items.length === 0) return res.status(400).json({ message: 'No items to order' });

        const orderId = 'AC' + Math.floor(100000 + Math.random() * 900000).toString();
        const now = Date.now();
        const timeline = [
            { t: now, label: 'Checking your kitchen' },
            { t: now + 1000, label: 'Found missing items' },
            { t: now + 2200, label: 'Searching quick commerce' },
            { t: now + 3500, label: 'Added to cart' },
            { t: now + 4800, label: 'Awaiting your confirmation' },
            { t: now + 6500, label: 'Order placed' }
        ];

        return res.status(200).json({ orderId, items, timeline });
    } catch (err) {
        return res.status(500).json({ message: 'Order simulation failed', error: err.message });
    }
};
