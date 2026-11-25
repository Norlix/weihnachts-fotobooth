<?php

namespace Photobooth\Configuration\Section;

use Symfony\Component\Config\Definition\Builder\NodeDefinition;
use Symfony\Component\Config\Definition\Builder\TreeBuilder;

final class ChristmasUiConfiguration
{
    public static function getNode(): NodeDefinition
    {
        return (new TreeBuilder('christmasui'))->getRootNode()->addDefaultsIfNotSet()
            ->ignoreExtraKeys()
            ->children()
                ->booleanNode('enabled')->defaultValue(false)->end()
                ->booleanNode('protect_viewer')->defaultValue(false)->end()
                ->scalarNode('title')->defaultValue('IBM Muccenter Christmas Fotobooth')->end()
                ->integerNode('idle_minutes')
                    ->defaultValue(5)
                    ->min(1)
                    ->max(60)
                    ->beforeNormalization()
                        ->ifString()
                        ->then(function (string $value): int {
                            return intval($value);
                        })
                        ->end()
                    ->end()
            ->end();
    }
}
