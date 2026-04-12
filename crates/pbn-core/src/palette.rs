use crate::models::{PaletteEntry, ProcessSettings};

/// 根据量化后的索引图和调色板生成稳定的颜色统计信息。
pub fn palette_stats(
    indexed_pixels: &[usize],
    colors: &[[u8; 3]],
    settings: &ProcessSettings,
) -> Vec<PaletteEntry> {
    let mut frequencies = vec![0usize; colors.len()];
    for &index in indexed_pixels {
        if let Some(slot) = frequencies.get_mut(index) {
            *slot += 1;
        }
    }

    let total = indexed_pixels.len().max(1) as f64;

    colors
        .iter()
        .enumerate()
        .map(|(index, color)| {
            let alias = settings
                .color_aliases
                .iter()
                .find(|(_, mapped)| *mapped == color)
                .map(|(name, _)| name.clone());

            PaletteEntry {
                index,
                color: *color,
                color_alias: alias,
                frequency: frequencies[index],
                area_percentage: frequencies[index] as f64 / total,
            }
        })
        .collect()
}
