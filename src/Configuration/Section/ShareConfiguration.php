<?php

namespace Photobooth\Configuration\Section;

use Symfony\Component\Config\Definition\Builder\NodeDefinition;
use Symfony\Component\Config\Definition\Builder\TreeBuilder;

final class ShareConfiguration
{
    public static function getNode(): NodeDefinition
    {
        return (new TreeBuilder('slideshowshare'))->getRootNode()->addDefaultsIfNotSet()
            ->ignoreExtraKeys()
            ->children()
                ->booleanNode('enabled')->defaultValue(false)->end()
                ->integerNode('timeout')
                    ->defaultValue(30)
                    ->min(5)
                    ->max(300)
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
