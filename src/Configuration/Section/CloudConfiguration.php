<?php

namespace Photobooth\Configuration\Section;

use Symfony\Component\Config\Definition\Builder\NodeDefinition;
use Symfony\Component\Config\Definition\Builder\TreeBuilder;

final class CloudConfiguration
{
    public static function getNode(): NodeDefinition
    {
        $integer = static fn (string $name, int $default, int $min, int $max) => (new TreeBuilder($name, 'integer'))->getRootNode()
            ->defaultValue($default)
            ->min($min)
            ->max($max)
            ->beforeNormalization()
                ->ifString()
                ->then(fn (string $value): int => intval($value))
                ->end();

        return (new TreeBuilder('cloud'))->getRootNode()->addDefaultsIfNotSet()
            ->ignoreExtraKeys()
            ->children()
                ->booleanNode('enabled')->defaultValue(false)->end()
                ->scalarNode('provider_name')->defaultValue('')->end()
                ->scalarNode('endpoint')->defaultValue('')->end()
                ->scalarNode('region')->defaultValue('')->end()
                ->scalarNode('bucket')->defaultValue('')->end()
                ->scalarNode('slideshow_bucket')->defaultValue('')->end()
                ->scalarNode('slideshow_endpoint')->defaultValue('')->end()
                ->scalarNode('slideshow_region')->defaultValue('')->end()
                ->scalarNode('public_base_url')->defaultValue('')->end()
                ->append($integer('retention_days', 7, 1, 365))
                ->append($integer('slideshow_width', 2560, 640, 7680))
                ->append($integer('slideshow_quality', 85, 40, 100))
            ->end();
    }
}
